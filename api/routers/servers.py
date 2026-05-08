# routers/servers.py
"""Server and channel-related API endpoints, powered by the database."""

from fastapi import APIRouter, Body, Path, HTTPException, status, Depends
from typing import List

# --- Model and Database Imports ---
from api.models.models import Server, ServerConfig, Channel, ChannelData
from api.db.database import Database
from api.auth import require_role
from pydantic import BaseModel

# --- Initialize Database Client ---
db = Database()


def _is_limited_mod(user: dict) -> bool:
    return (user or {}).get("role") == "mod"


def _ensure_server_scope(user: dict, server_id: str):
    if not _is_limited_mod(user):
        return
    allowed = set(db.get_user_server_access(int(user["id"])))
    if server_id not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this server.")

router = APIRouter(
    prefix="/api/servers",
    tags=["Servers & Channels"]
)

# --- Server Endpoints ---

@router.get("/", response_model=List[Server])
async def list_servers(user: dict = Depends(require_role("mod"))):
    """List all servers available in the database."""
    try:
        servers = db.list_servers()
        if _is_limited_mod(user):
            allowed = set(db.get_user_server_access(int(user["id"])))
            return [s for s in servers if s.get("server_id") in allowed]
        return servers
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=Server, status_code=status.HTTP_201_CREATED)
async def create_server(server: Server = Body(..., description="Server data to create"), current_user: dict = Depends(require_role("admin"))):
    """Create a new server record in the database."""
    if db.get_server(server.server_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Server with ID '{server.server_id}' already exists."
        )
    try:
        db.create_server(
            server_id=server.server_id,
            server_name=server.server_name,
            description=server.description,
            instruction=server.instruction
        )
        db.log_admin('server.create', target=f"{server.server_name} ({server.server_id})", actor=current_user)
        return server
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create server: {e}")

@router.get("/{server_id}", response_model=Server)
async def get_server(server_id: str = Path(..., description="The unique ID of the server"), user: dict = Depends(require_role("mod"))):
    """Get a specific server's configuration."""
    _ensure_server_scope(user, server_id)
    server = db.get_server(server_id)
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Server '{server_id}' not found")
    return server

@router.get("/{server_id}/config", response_model=ServerConfig)
async def get_server_config(server_id: str = Path(...), user: dict = Depends(require_role("mod"))):
    """Get per-server config overrides."""
    _ensure_server_scope(user, server_id)
    if not db.get_server(server_id):
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    return db.get_server_config(server_id)

@router.patch("/{server_id}/config", response_model=ServerConfig)
async def update_server_config(server_id: str = Path(...), body: ServerConfig = Body(...), current_user: dict = Depends(require_role("admin"))):
    """Set per-server config overrides. Only provided (non-null) fields are saved."""
    if not db.get_server(server_id):
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    current = db.get_server_config(server_id)
    updates = body.model_dump(exclude_none=True)
    current.update(updates)
    db.set_server_config(server_id, current)
    db.log_admin('servers.override.on', target=server_id, detail=str(updates), actor=current_user)
    return current

@router.delete("/{server_id}/config", status_code=status.HTTP_204_NO_CONTENT)
async def reset_server_config(server_id: str = Path(...), current_user: dict = Depends(require_role("admin"))):
    """Reset all per-server config overrides back to global defaults."""
    if not db.get_server(server_id):
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    db.clear_server_config(server_id)
    db.log_admin('servers.override.off', target=server_id, actor=current_user)
    return None

@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(server_id: str = Path(..., description="The unique ID of the server"), current_user: dict = Depends(require_role("admin"))):
    """
    Delete a server and all its associated channels from the database.
    This action is irreversible due to cascading deletes.
    """
    if not db.get_server(server_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Server '{server_id}' not found")
    try:
        db.delete_server(server_id)
        db.log_admin('server.delete', target=server_id, actor=current_user)
        return None
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete server: {e}")


# --- Channel Endpoints ---

# We need a request model because channel_id is provided by the client
class CreateChannelRequest(BaseModel):
    channel_id: str
    data: ChannelData

@router.post("/{server_id}/channels", response_model=Channel, status_code=status.HTTP_201_CREATED)
async def create_channel(
    server_id: str = Path(..., description="The server ID to add the channel to"),
    request: CreateChannelRequest = Body(..., description="The new channel's ID and configuration"),
    current_user: dict = Depends(require_role("admin"))
):
    """Create a new channel configuration within a specific server."""
    server = db.get_server(server_id)
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Server '{server_id}' not found")
    if db.get_channel(request.channel_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Channel with ID '{request.channel_id}' already exists."
        )

    try:
        # Use by_alias=True to correctly handle the 'global' field name
        channel_data_dict = request.data.model_dump(by_alias=True)
        db.create_channel(
            channel_id=request.channel_id,
            server_id=server_id,
            server_name=server["server_name"],
            data=channel_data_dict
        )
        db.log_admin('channel.create', target=f"{request.data.name} ({request.channel_id})", actor=current_user)
        return db.get_channel(request.channel_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create channel: {e}")

@router.get("/{server_id}/channels", response_model=List[Channel])
async def list_channels_in_server(server_id: str = Path(..., description="The unique ID of the server"), user: dict = Depends(require_role("mod"))):
    """List all channels in a specific server."""
    _ensure_server_scope(user, server_id)
    if not db.get_server(server_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Server '{server_id}' not found")
    return db.list_channels_for_server(server_id)

@router.get("/{server_id}/channels/{channel_id}", response_model=Channel)
async def get_channel(
    server_id: str = Path(..., description="The server ID"),
    channel_id: str = Path(..., description="The unique channel ID"),
    user: dict = Depends(require_role("mod"))
):
    """Get a specific channel's configuration."""
    _ensure_server_scope(user, server_id)
    channel = db.get_channel(channel_id)
    if not channel or channel['server_id'] != server_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Channel '{channel_id}' not found in server '{server_id}'")
    return channel

@router.put("/{server_id}/channels/{channel_id}", response_model=Channel)
async def update_channel(
    server_id: str = Path(..., description="The server ID"),
    channel_id: str = Path(..., description="The unique channel ID"),
    channel_data: ChannelData = Body(..., description="The updated channel data"),
    current_user: dict = Depends(require_role("admin"))
):
    """Update an existing channel's configuration."""
    existing_channel = db.get_channel(channel_id)
    if not existing_channel or existing_channel['server_id'] != server_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Channel '{channel_id}' not found in server '{server_id}'")

    try:
        # Use by_alias=True to correctly handle the 'global' field name
        channel_data_dict = channel_data.model_dump(by_alias=True)
        db.update_channel(channel_id, data=channel_data_dict)
        db.log_admin('channel.update', target=f"{channel_data.name} ({channel_id})", actor=current_user)
        return db.get_channel(channel_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update channel: {e}")

@router.delete("/{server_id}/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(
    server_id: str = Path(..., description="The server ID"),
    channel_id: str = Path(..., description="The unique channel ID"),
    current_user: dict = Depends(require_role("admin"))
):
    """Delete a channel's configuration."""
    existing_channel = db.get_channel(channel_id)
    if not existing_channel or existing_channel['server_id'] != server_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Channel '{channel_id}' not found in server '{server_id}'")

    try:
        db.delete_channel(channel_id)
        db.log_admin('channel.delete', target=f"{existing_channel.get('data', {}).get('name', channel_id)} ({channel_id})", actor=current_user)
        return None
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete channel: {e}")