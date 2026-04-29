# src/utils/discord_utils.py

import os
import re
import discord
from urllib.parse import urlparse

def is_valid_url(url: str) -> bool:
    """Check if a string is a valid HTTP/S URL."""
    try:
        result = urlparse(str(url))
        return all([result.scheme, result.netloc]) and result.scheme in ['http', 'https']
    except (ValueError, AttributeError):
        return False

def is_local_file(path: str) -> bool:
    """Check if a string represents an existing local file path."""
    try:
        path_str = str(path).strip()
        return not path_str.startswith(('http://', 'https://')) and os.path.exists(path_str)
    except (ValueError, AttributeError):
        return False
    
def _parse_content_description(text: str) -> str:
    line = text.splitlines()[0].strip()
    if line.lower().startswith("content description:"):
        line = line[len("content description:"):].strip()
    return line or "*gif*"

def get_gif_content_description(message: discord.Message) -> str | None:
    """If message contains a GIF, returns its content description or '*gif*'. Returns None if not a GIF."""
    for att in message.attachments:
        if att.content_type == 'image/gif' or att.filename.lower().endswith('.gif'):
            return _parse_content_description(att.description) if att.description else "*gif*"
    for embed in message.embeds:
        if embed.type == 'gifv':
            return _parse_content_description(embed.description) if embed.description else "*gif*"
    if re.search(r'https?://(tenor\.com|giphy\.com|media\.tenor\.com|c\.tenor\.com)', message.content):
        return "*gif*"
    return None

def is_gif_message(message: discord.Message) -> bool:
    """Returns True if the message is a GIF."""
    return get_gif_content_description(message) is not None

def extract_valid_urls(text: str) -> list[str]:
    """Extract all valid HTTP/S URLs from a given string."""
    # Regex to find potential URLs
    url_pattern = re.compile(r'(https?://[^\s]+)')
    possible_urls = url_pattern.findall(text)

    # Filter only valid URLs
    valid_urls = [url for url in possible_urls if is_valid_url(url)]
    return valid_urls