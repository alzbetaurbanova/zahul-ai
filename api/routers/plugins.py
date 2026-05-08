# api/routers/plugins.py
from fastapi import APIRouter, Request, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from api.db.database import Database
from api.auth import require_role

_db = Database()

router = APIRouter(prefix="/plugins", tags=["Plugins"])

# --- Pydantic Models for API Responses ---
class PluginInfo(BaseModel):
    name: str
    triggers: List[str]

class PluginResponse(BaseModel):
    status: str
    count: int
    plugins: List[PluginInfo]

# --- Routes ---

@router.get("/", response_model=PluginResponse)
async def list_plugins(request: Request, _: dict = Depends(require_role("admin"))):
    """
    List all currently loaded plugins and their triggers.
    """
    manager = request.app.state.plugin_manager
    
    info_list = []
    for p in manager.plugins:
        info_list.append(PluginInfo(
            name=p.__class__.__name__,
            triggers=p.triggers
        ))
    
    return {
        "status": "ok",
        "count": len(info_list),
        "plugins": info_list
    }

@router.post("/reload")
async def reload_plugins(request: Request, current_user: dict = Depends(require_role("admin"))):
    """
    Hot-reload plugins from the disk without restarting the server.
    """
    manager = request.app.state.plugin_manager
    try:
        manager.reload_plugins()
        
        # Build info list for response
        info_list = [
            PluginInfo(name=p.__class__.__name__, triggers=p.triggers) 
            for p in manager.plugins
        ]
        
        _db.log_admin('plugins.reload', detail=f"{len(info_list)} plugins loaded", actor=current_user)
        return {
            "status": "reloaded",
            "count": len(manager.plugins),
            "plugins": info_list
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))