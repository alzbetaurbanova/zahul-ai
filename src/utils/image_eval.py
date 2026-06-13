import base64
import re
import traceback
from openai import AsyncOpenAI

from api.db.database import Database
from api.models.models import BotConfig

def get_bot_config(db: Database) -> BotConfig:
    from src.utils.llm_new import get_bot_config as _cached
    return _cached(db)

async def describe_image(image_path: str, db: Database) -> str:
    """
    Takes an image file path, sends it to the configured vision model,
    and returns a description of the image.
    """
    bot_config = get_bot_config(db)

    if not bot_config.multi_model_enable:
        return "<ERROR> Image description is disabled in the bot's configuration."

    if not bot_config.multi_model_ai_model:
        return "<ERROR> The vision model is not configured in the bot's settings."

    # Resolve endpoint/key: prefer named provider, fall back to legacy flat fields
    endpoint = bot_config.multi_model_ai_endpoint
    api_key = bot_config.multi_model_ai_api or "none"
    prov_name = bot_config.multi_model_ai_provider
    if prov_name:
        for p in (bot_config.multi_model_providers or []):
            if p.name == prov_name:
                endpoint = p.endpoint
                api_key = p.api_key or "none"
                break

    if not endpoint:
        return "<ERROR> The vision endpoint is not configured. Select a provider model or set a legacy endpoint."

    try:
        with open(image_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode("utf-8")

        client = AsyncOpenAI(base_url=endpoint, api_key=api_key)

        response = await client.chat.completions.create(
            model=bot_config.multi_model_ai_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Write a descriptive caption for this image. If it contains any text or writing, transcribe all of it accurately."},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
                    ],
                }
            ],
            max_tokens=1024,
        )

        description = response.choices[0].message.content
        return description if description else "<INFO> The AI returned an empty description for the image."

    except Exception as e:
        print(f"Error describing image: {e}\n{traceback.format_exc()}")
        return f"<ERROR> Image failed to load or process. Check the bot's logs for details."
    

def strip_thinking(text: str) -> str:
    """
    Removes everything before and including the closing think markers:
    - </think>
    - ◁/think▶
    - \u25c1/think\u25b7 (literal unicode escape)
    Returns the cleaned text.
    """
    # Remove everything up to and including any closing think marker
    cleaned = re.sub(r"(?s)^.*?(?:</think>|◁/think▶|◁/think▷|\\u25c1/think\\u25b7)", "", text)
    return cleaned.strip()