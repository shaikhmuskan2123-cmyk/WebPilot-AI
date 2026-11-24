import os
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

temporary_directory = tempfile.TemporaryDirectory()
database_path = os.path.join(temporary_directory.name, "test.db")
os.environ["DATABASE_URL"] = f"sqlite:///{database_path.replace(os.sep, '/')}"
os.environ["SEARCH_PROVIDER"] = "demo"
os.environ["LLM_PROVIDER"] = "demo"

from fastapi.testclient import TestClient
from app.main import app
from app.services.auth_service import UserIdentity, require_user


class TaskApiTests(unittest.TestCase):
    def setUp(self):
        self.user_id = "test-user-a"
        app.dependency_overrides[require_user] = lambda: UserIdentity(
            id=self.user_id, email=f"{self.user_id}@example.com", display_name="Test User"
        )
        self.client = TestClient(app)

    def test_create_execute_list_and_delete_task(self):
        created = self.client.post("/api/tasks", json={"instruction": "Compare five AI tools for students"})
        self.assertEqual(created.status_code, 200)
        task_id = created.json()["id"]

        executed = self.client.post(f"/api/tasks/{task_id}/execute")
        self.assertEqual(executed.status_code, 200)
        self.assertEqual(executed.json()["status"], "completed")

        results = self.client.get(f"/api/tasks/{task_id}/results")
        self.assertEqual(results.status_code, 200)
        self.assertEqual(results.json()["mode"], "demo")
        self.assertTrue(results.json()["comparison_data"])

        sources = self.client.get(f"/api/tasks/{task_id}/sources")
        self.assertEqual(sources.status_code, 200)
        self.assertTrue(all("example" in source["url"] for source in sources.json()))

        self.assertTrue(any(task["id"] == task_id for task in self.client.get("/api/tasks").json()))
        deleted = self.client.delete(f"/api/tasks/{task_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get(f"/api/tasks/{task_id}").status_code, 404)

    def test_rejects_short_instruction(self):
        response = self.client.post("/api/tasks", json={"instruction": "no"})
        self.assertEqual(response.status_code, 422)

    def test_planning_progress_and_report_exports(self):
        created = self.client.post("/api/tasks", json={"instruction": "Compare five AI tools for students"})
        task_id = created.json()["id"]
        planned = self.client.post(f"/api/tasks/{task_id}/plan")
        self.assertEqual(planned.status_code, 200)
        self.assertTrue(planned.json()["plan"])

        executed = self.client.post(f"/api/tasks/{task_id}/execute")
        self.assertEqual(executed.status_code, 200)
        progress = self.client.get(f"/api/tasks/{task_id}/progress")
        self.assertEqual(progress.status_code, 200)
        report = self.client.post(f"/api/tasks/{task_id}/reports?report_type=technology_comparison")
        self.assertEqual(report.status_code, 200)

        csv_export = self.client.get(f"/api/reports/{report.json()['id']}/export?format=csv")
        self.assertEqual(csv_export.status_code, 200)
        pdf_export = self.client.get(f"/api/reports/{report.json()['id']}/export?format=pdf")
        self.assertIn(pdf_export.status_code, (200, 503))

    def test_auth_registration_login_and_me(self):
        auth_result = {
            "user": {
                "id": "test-user-a",
                "email": "webpilot-test@example.com",
                "user_metadata": {"display_name": "Test User"},
            },
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "token_type": "bearer",
            "expires_in": 3600,
        }
        with patch("app.api.auth.supabase_auth_request", new=AsyncMock(return_value=auth_result)):
            registered = self.client.post("/api/auth/register", json={
                "email": "webpilot-test@example.com",
                "password": "a-secure-password",
                "display_name": "Test User",
            })
            self.assertEqual(registered.status_code, 200)
            self.assertEqual(registered.json()["session"]["access_token"], "access-token")
            logged_in = self.client.post("/api/auth/login", json={
                "email": "webpilot-test@example.com", "password": "a-secure-password",
            })
            self.assertEqual(logged_in.status_code, 200)
            self.assertEqual(logged_in.json()["user"]["email"], "webpilot-test@example.com")

        me = self.client.get("/api/auth/me")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["email"], "test-user-a@example.com")

    def test_user_cannot_access_another_users_tasks(self):
        created = self.client.post("/api/tasks", json={"instruction": "Compare five AI tools for students"})
        task_id = created.json()["id"]
        self.user_id = "test-user-b"

        self.assertEqual(self.client.get("/api/tasks").json(), [])
        self.assertEqual(self.client.get(f"/api/tasks/{task_id}").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/tasks/{task_id}").status_code, 404)

    def test_user_cannot_access_another_users_templates_or_preferences(self):
        created = self.client.post("/api/templates", json={
            "name": "My template", "instruction": "Compare student research tools",
        })
        template_id = created.json()["id"]
        self.client.put("/api/preferences", json={"preferences": {"research_interests": "science"}})
        self.user_id = "test-user-b"

        self.assertEqual(self.client.get("/api/templates").json(), [])
        self.assertEqual(self.client.delete(f"/api/templates/{template_id}").status_code, 404)
        self.assertEqual(self.client.get("/api/preferences").json(), {})

    def test_user_cannot_access_another_users_reports_or_approvals(self):
        created = self.client.post("/api/tasks", json={"instruction": "Compare five AI tools for students"})
        task_id = created.json()["id"]
        self.client.post(f"/api/tasks/{task_id}/execute")
        report = self.client.post(f"/api/tasks/{task_id}/reports")
        approval = self.client.post("/api/approvals", json={"action": "Review a proposed action"})
        report_id = report.json()["id"]
        approval_id = approval.json()["id"]
        self.user_id = "test-user-b"

        self.assertEqual(self.client.get("/api/reports").json(), [])
        self.assertEqual(self.client.get(f"/api/reports/{report_id}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/reports/{report_id}/export").status_code, 404)
        self.assertEqual(self.client.get("/api/approvals").json(), [])
        self.assertEqual(self.client.post(f"/api/approvals/{approval_id}/approve").status_code, 404)

    def test_private_api_requires_auth_but_health_is_public(self):
        app.dependency_overrides.pop(require_user)

        self.assertEqual(self.client.get("/api/tasks").status_code, 401)
        self.assertEqual(self.client.get("/api/templates").status_code, 401)
        self.assertEqual(self.client.get("/api/health").status_code, 200)

    @classmethod
    def tearDownClass(cls):
        from app.database import engine

        app.dependency_overrides.clear()
        engine.dispose()
        temporary_directory.cleanup()


if __name__ == "__main__":
    unittest.main()
