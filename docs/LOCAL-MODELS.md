# Local models and OpenAI-compatible APIs

Open **Profile & settings → OpenAI-compatible API / local models** on your computer.

1. Start your model server and load a model.
2. Enter its API base URL, including `/v1` when required. Leave the key empty if your local server needs no authentication.
3. Click **Discover models**, or type model IDs manually, one per line. Use the exact IDs your server expects.
4. Save. Open a bot’s name pill, select **Compatible API / local**, and choose its model.
5. To use the endpoint for new bots, click **Use for new bots** in settings. The first listed model becomes the default.

Typical base URLs (verify your server's configured port):

| Server | Base URL |
| --- | --- |
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp / vLLM | `http://localhost:8080/v1` or your server's chosen port |
| Hosted compatible service | Its documented API base URL and API key |

Minds uses standard Chat Completions (`POST /chat/completions`) with streaming and
function tools. Servers that return a complete JSON reply also work. Model discovery
uses `GET /models`; it is optional. Keys stay on the host and are omitted from client state.

Enable tool calling for models and servers that support it. For chat-only models,
turn **Enable tool calling** off. Reasoning effort is only sent to the ChatGPT provider;
compatible servers use their own defaults.

Each bot stores its provider and model. Existing ChatGPT bots keep their provider.
Phones send requests to the computer, so `localhost` means the computer running
Minds, and the model server does not need to be exposed to the phone or internet.
Voice transcription and model-based safety review still use the separate OpenRouter
setting; local heuristic safety and permission prompts remain available without it.
