from __future__ import annotations

import hmac
import json
import secrets
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = 43127
ALLOWED_ORIGIN = "https://northassembly.work.gd"
REPOSITORY_SLUG = "belfegor442/belfegor442.github.io"
ROOT = Path(__file__).resolve().parent.parent
NEWS_FILE = ROOT / "docs" / "news.json"
PUBLISH_CODE = secrets.token_urlsafe(18)
PUBLISH_COMMIT_MESSAGE = "Update North Assembly broadcast"


def git(*args: str, timeout: int = 45) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )


def git_output(*args: str) -> str:
    result = git(*args)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Error de Git sin detalles").strip()
        raise RuntimeError(detail)
    return result.stdout.strip()


def publish(headline: str) -> dict[str, object]:
    if not ROOT.is_dir() or not (ROOT / ".git").exists():
        raise RuntimeError("El Publisher debe ejecutarse desde una copia clonada del repositorio, no desde un ZIP.")
    if not NEWS_FILE.is_file():
        raise RuntimeError("No existe docs/news.json en esta copia del repositorio.")

    remote = git_output("remote", "get-url", "origin").lower()
    if REPOSITORY_SLUG not in remote:
        raise RuntimeError("El remoto origin no corresponde al repositorio oficial de North Assembly.")

    branch = git_output("branch", "--show-current")
    if branch != "main":
        raise RuntimeError(f"La copia local está en la rama '{branch}', no en 'main'. Cambia a main antes de publicar.")

    fetch = git("fetch", "origin", "main", timeout=60)
    if fetch.returncode != 0:
        raise RuntimeError((fetch.stderr or fetch.stdout or "No se pudo sincronizar con GitHub.").strip())

    local_head = git_output("rev-parse", "HEAD")
    remote_head = git_output("rev-parse", "origin/main")
    behind = int(git_output("rev-list", "--count", "HEAD..origin/main"))
    ahead = int(git_output("rev-list", "--count", "origin/main..HEAD"))

    if behind:
        raise RuntimeError("La copia local está atrasada respecto a GitHub. Actualiza el repositorio antes de publicar.")

    if ahead:
        subjects = git_output("log", "--format=%s", "origin/main..HEAD").splitlines()
        if not subjects or any(subject != PUBLISH_COMMIT_MESSAGE for subject in subjects):
            raise RuntimeError("Hay commits locales pendientes que no creó el Publisher. Revísalos antes de publicar.")
        retry_push = git("push", "origin", "main", timeout=90)
        if retry_push.returncode != 0:
            detail = (retry_push.stderr or retry_push.stdout or "GitHub rechazó el envío.").strip()
            raise RuntimeError("Hay una publicación local pendiente y no se pudo enviar a GitHub: " + detail)
        local_head = git_output("rev-parse", "HEAD")
        remote_head = git_output("rev-parse", "origin/main")

    if local_head != remote_head:
        raise RuntimeError("La copia local no está sincronizada con origin/main. Actualiza el repositorio antes de publicar.")

    staged = git("diff", "--cached", "--quiet")
    if staged.returncode == 1:
        raise RuntimeError("Hay cambios preparados en Git. Haz commit o deshazlos antes de usar el Publisher.")
    if staged.returncode != 0:
        raise RuntimeError((staged.stderr or "No se pudo comprobar el estado de Git.").strip())

    news_status = git("status", "--porcelain", "--", "docs/news.json")
    if news_status.returncode != 0:
        raise RuntimeError((news_status.stderr or "No se pudo comprobar docs/news.json.").strip())
    if news_status.stdout.strip():
        raise RuntimeError("docs/news.json tiene cambios locales sin guardar. Sincroniza ese archivo antes de publicar.")

    old_content = NEWS_FILE.read_bytes()
    new_content = (json.dumps({"headline": headline}, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if old_content == new_content:
        return {"success": True, "updated": False, "commit": local_head}

    try:
        NEWS_FILE.write_bytes(new_content)
        add = git("add", "--", "docs/news.json")
        if add.returncode != 0:
            raise RuntimeError((add.stderr or add.stdout or "No se pudo preparar docs/news.json.").strip())

        commit = git("commit", "-m", PUBLISH_COMMIT_MESSAGE)
        if commit.returncode != 0:
            git("restore", "--staged", "--", "docs/news.json")
            NEWS_FILE.write_bytes(old_content)
            raise RuntimeError((commit.stderr or commit.stdout or "Git no pudo crear el commit.").strip())

        commit_sha = git_output("rev-parse", "HEAD")
        push = git("push", "origin", "main", timeout=90)
        if push.returncode != 0:
            detail = (push.stderr or push.stdout or "GitHub rechazó el envío.").strip()
            return {
                "success": False,
                "error": "El commit se guardó localmente, pero no se pudo enviar a GitHub: " + detail,
                "commit": commit_sha,
            }

        return {"success": True, "updated": True, "commit": commit_sha}
    except Exception:
        head_after = git("rev-parse", "HEAD")
        if head_after.returncode == 0 and head_after.stdout.strip() == local_head:
            git("restore", "--staged", "--", "docs/news.json")
            NEWS_FILE.write_bytes(old_content)
        raise


class PublisherHandler(BaseHTTPRequestHandler):
    server_version = "NorthAssemblyPublisher/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        print("[Publisher] " + (fmt % args))

    def send_json(self, status: int, payload: dict[str, object], *, cors: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Origin")
        if cors:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.end_headers()
        self.wfile.write(body)

    def valid_origin(self) -> bool:
        return self.headers.get("Origin", "") == ALLOWED_ORIGIN

    def do_OPTIONS(self) -> None:
        if urlparse(self.path).path != "/publish" or not self.valid_origin():
            self.send_json(403, {"success": False, "error": "Origen no autorizado."})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/publish":
            self.send_json(404, {"success": False, "error": "Ruta no encontrada."})
            return
        if not self.valid_origin():
            self.send_json(403, {"success": False, "error": "Origen no autorizado."})
            return
        if not self.headers.get("Content-Type", "").lower().startswith("application/json"):
            self.send_json(415, {"success": False, "error": "Se requiere application/json."}, cors=True)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 8192:
                raise ValueError("Tamaño de solicitud no válido.")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("El cuerpo de la solicitud no es un objeto JSON.")
            headline = str(payload.get("headline", "")).strip()
            supplied_code = str(payload.get("code", ""))
            if not hmac.compare_digest(supplied_code.encode("utf-8"), PUBLISH_CODE.encode("utf-8")):
                self.send_json(403, {"success": False, "error": "Código del Publisher incorrecto."}, cors=True)
                return
            if not headline or len(headline) > 180:
                self.send_json(400, {"success": False, "error": "El titular debe tener entre 1 y 180 caracteres."}, cors=True)
                return
            result = publish(headline)
            status = 200 if result.get("success") else 502
            self.send_json(status, result, cors=True)
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            self.send_json(400, {"success": False, "error": str(exc)}, cors=True)
        except subprocess.TimeoutExpired:
            self.send_json(504, {"success": False, "error": "Git tardó demasiado. Comprueba la conexión y el estado del repositorio."}, cors=True)
        except Exception as exc:
            self.send_json(500, {"success": False, "error": str(exc)}, cors=True)


def main() -> int:
    if sys.version_info < (3, 10):
        print("Se necesita Python 3.10 o superior.")
        return 1
    try:
        server = ThreadingHTTPServer((HOST, PORT), PublisherHandler)
    except OSError as exc:
        print(f"No se puede iniciar North Assembly Publisher en {HOST}:{PORT}: {exc}")
        return 1

    print("=" * 62)
    print(" NORTH ASSEMBLY PUBLISHER — LOCAL SERVICE")
    print("=" * 62)
    print(f"Repositorio: {ROOT}")
    print(f"Dirección:   http://{HOST}:{PORT}/publish")
    print("Origen web:  " + ALLOWED_ORIGIN)
    print("\nCÓDIGO TEMPORAL (pégalo cuando la web lo solicite):")
    print(PUBLISH_CODE)
    print("\nDeja esta ventana abierta mientras publiques noticias.")
    print("Pulsa Ctrl+C para detener el servicio.\n")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nCerrando North Assembly Publisher...")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
