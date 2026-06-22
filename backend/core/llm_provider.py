
# backend/core/llm_provider.py
"""LLM provider adapter for Groq / OpenAI / Gemini.

Scenario modules can keep using `client.chat.completions.create(...)`.
This adapter returns an OpenAI/Groq-like object with
`choices[0].message.content`, so existing scenario_a/b/c code needs only a
small import/client replacement.
"""
from __future__ import annotations

import os
from types import SimpleNamespace
from typing import Any, Iterable

import config
from dotenv import load_dotenv

load_dotenv()


def get_active_llm_provider() -> str:
    mode = str(getattr(config, "LLM_RUN_MODE", "pilot") or "pilot").lower()
    if mode == "formal":
        provider = getattr(config, "FORMAL_LLM_PROVIDER", "openai")
    else:
        provider = getattr(config, "PILOT_LLM_PROVIDER", "groq")
    return str(provider or "groq").lower()


def get_active_llm_model() -> str:
    provider = get_active_llm_provider()
    if provider == "openai":
        return getattr(config, "OPENAI_MODEL_NAME", "gpt-5-nano")
    if provider == "gemini":
        return getattr(config, "GEMINI_MODEL_NAME", "gemini-2.5-flash-lite")
    return getattr(config, "GROQ_MODEL_NAME", getattr(config, "MODEL_NAME", "llama-3.1-8b-instant"))


def get_active_llm_mode() -> str:
    return str(getattr(config, "LLM_RUN_MODE", "pilot") or "pilot").lower()


def _to_completion(content: str, prompt_tokens: int = 0, completion_tokens: int = 0) -> Any:
    usage = SimpleNamespace(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=usage,
    )


class _GeminiCompletions:
    def create(self, *, model: str, messages: list[dict[str, Any]], stream: bool = False, **kwargs: Any) -> Any:
        try:
            import google.generativeai as genai  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("Gemini provider requires `google-generativeai`.") from exc

        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("Missing GEMINI_API_KEY or GOOGLE_API_KEY")
        genai.configure(api_key=api_key)

        system_parts: list[str] = []
        prompt_parts: list[str] = []
        for msg in messages:
            role = msg.get("role", "user")
            content = str(msg.get("content", ""))
            if role == "system":
                system_parts.append(content)
            elif role == "assistant":
                prompt_parts.append(f"Assistant: {content}")
            else:
                prompt_parts.append(f"User: {content}")
        full_prompt = "\n\n".join(system_parts + prompt_parts)
        generation_config = {}
        if "temperature" in kwargs:
            generation_config["temperature"] = kwargs["temperature"]
        if "max_tokens" in kwargs:
            generation_config["max_output_tokens"] = kwargs["max_tokens"]

        gm = genai.GenerativeModel(model)
        if stream:
            response_stream = gm.generate_content(full_prompt, generation_config=generation_config or None, stream=True)

            def iterator() -> Iterable[Any]:
                for chunk in response_stream:
                    text = getattr(chunk, "text", "") or ""
                    yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text))])
            return iterator()
        response = gm.generate_content(full_prompt, generation_config=generation_config or None)
        return _to_completion(getattr(response, "text", "") or "")


class _OpenAICompletions:
    def __init__(self) -> None:
        try:
            from openai import OpenAI  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("OpenAI provider requires `openai`.") from exc
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("Missing OPENAI_API_KEY")
        self.client = OpenAI(api_key=api_key)

    def create(self, *args: Any, **kwargs: Any) -> Any:
        return self.client.chat.completions.create(*args, **kwargs)


class _GroqCompletions:
    def __init__(self) -> None:
        from groq import Groq  # type: ignore
        self.client = Groq(api_key=os.getenv("GROQ_API_KEY"))

    def create(self, *args: Any, **kwargs: Any) -> Any:
        return self.client.chat.completions.create(*args, **kwargs)


class _Chat:
    def __init__(self, completions: Any) -> None:
        self.completions = completions


class LLMClient:
    def __init__(self) -> None:
        provider = get_active_llm_provider()
        if provider == "openai":
            completions = _OpenAICompletions()
        elif provider == "gemini":
            completions = _GeminiCompletions()
        else:
            completions = _GroqCompletions()
        self.chat = _Chat(completions)


def get_chat_client() -> LLMClient:
    return LLMClient()
