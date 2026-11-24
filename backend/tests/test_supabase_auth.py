import os
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.services.auth_service import resolve_user, supabase_auth_request
from app.services.analysis_service import analyze
from app.services.search_service import search_web


class SupabaseAuthTests(IsolatedAsyncioTestCase):
    async def test_openai_live_mode_uses_configured_server_key_and_model(self):
        requests = []

        def handle_request(request):
            requests.append(request)
            return httpx.Response(200, json={
                "choices": [{"message": {"content": '{"summary":"Supported summary","comparison_data":[],"recommendations":[]}'}}],
            })

        transport = httpx.MockTransport(handle_request)
        original_client = httpx.AsyncClient

        def client_factory(**kwargs):
            return original_client(transport=transport, **kwargs)

        with patch.dict(os.environ, {
            "LLM_PROVIDER": "openai",
            "OPENAI_API_KEY": "openai-test-key",
            "OPENAI_MODEL": "test-model",
        }), patch("app.services.analysis_service.httpx.AsyncClient", side_effect=client_factory):
            result = await analyze("Summarize this", [])

        self.assertEqual(result["summary"], "Supported summary")
        self.assertEqual(requests[0].headers["authorization"], "Bearer openai-test-key")
        self.assertEqual(json.loads(requests[0].content)["model"], "test-model")

    async def test_tavily_live_mode_uses_configured_server_key(self):
        requests = []

        def handle_request(request):
            requests.append(request)
            return httpx.Response(200, json={"results": [{
                "title": "Official source",
                "url": "https://example.org/research",
                "content": "Search snippet",
            }]})

        transport = httpx.MockTransport(handle_request)
        original_client = httpx.AsyncClient

        def client_factory(**kwargs):
            return original_client(transport=transport, **kwargs)

        with patch.dict(os.environ, {
            "SEARCH_PROVIDER": "tavily",
            "TAVILY_API_KEY": "tavily-test-key",
        }), patch("app.services.search_service.httpx.AsyncClient", side_effect=client_factory):
            results = await search_web("research topic", limit=3)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["title"], "Official source")
        self.assertEqual(json.loads(requests[0].content)["api_key"], "tavily-test-key")

    async def test_auth_request_uses_only_publishable_key(self):
        requests = []

        def handle_request(request):
            requests.append(request)
            return httpx.Response(200, json={"user": {"id": "user-1"}})

        transport = httpx.MockTransport(handle_request)
        original_client = httpx.AsyncClient

        def client_factory(**kwargs):
            return original_client(transport=transport, **kwargs)

        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_PUBLISHABLE_KEY": "public-placeholder",
        }), patch("app.services.auth_service.httpx.AsyncClient", side_effect=client_factory):
            response = await supabase_auth_request("signup", {"email": "user@example.com"})

        self.assertEqual(response["user"]["id"], "user-1")
        self.assertEqual(requests[0].headers["apikey"], "public-placeholder")
        self.assertNotIn("authorization", requests[0].headers)
        self.assertEqual(requests[0].url.path, "/auth/v1/signup")

    def test_jwks_verified_access_token_produces_user_identity(self):
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_key = private_key.public_key()
        claims = {
            "sub": "user-123",
            "email": "person@example.com",
            "user_metadata": {"display_name": "Person"},
            "aud": "authenticated",
            "iss": "https://project.supabase.co/auth/v1",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        }
        token = jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "test-key"})
        jwks = SimpleNamespace(
            get_signing_key_from_jwt=lambda _token: SimpleNamespace(key=public_key)
        )

        with patch.dict(os.environ, {"SUPABASE_URL": "https://project.supabase.co"}), \
                patch("app.services.auth_service._jwks_client", return_value=jwks):
            user = resolve_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))

        self.assertEqual(user.id, "user-123")
        self.assertEqual(user.email, "person@example.com")
        self.assertEqual(user.display_name, "Person")

    def test_jwks_verified_access_token_rejects_wrong_issuer(self):
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        claims = {
            "sub": "user-123",
            "aud": "authenticated",
            "iss": "https://attacker.example/auth/v1",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        }
        token = jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "test-key"})
        jwks = SimpleNamespace(
            get_signing_key_from_jwt=lambda _token: SimpleNamespace(key=private_key.public_key())
        )

        with patch.dict(os.environ, {"SUPABASE_URL": "https://project.supabase.co"}), \
                patch("app.services.auth_service._jwks_client", return_value=jwks):
            with self.assertRaises(HTTPException) as error:
                resolve_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))

        self.assertEqual(error.exception.status_code, 401)
