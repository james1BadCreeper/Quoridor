"""AI 管理：zip 上传、编译、沙箱运行。

约定（方案 A）：
- 用户 zip 内包含 C++ 源码，只需实现一个函数：
    Move decide(const State &state)
  并 #include "quoridor_sdk.h"，不要自己写 main()。
- 平台在编译时自动加入 sdk/runner.cpp（内含 main：stdin 读 JSON -> decide -> stdout 写 JSON）。
- 运行协议：stdin 传入一局面的 JSON（含 legalMoves），stdout 返回一步的 JSON。
"""
from __future__ import annotations

import io
import json
import os
import re
import resource
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
SDK_DIR = BACKEND_DIR / "sdk"
DATA_DIR = BACKEND_DIR / "data" / "ais"
DATA_DIR.mkdir(parents=True, exist_ok=True)

MAX_ZIP_BYTES = 5 * 1024 * 1024
MAX_FILES = 50
ALLOWED_SUFFIX = {".cpp", ".cc", ".cxx", ".h", ".hpp", ".txt", ".md"}
COMPILE_TIMEOUT = 30
DOCKER_IMAGE = os.environ.get("QUORIDOR_DOCKER_IMAGE", "gcc:13")
DOCKER_MEMORY = os.environ.get("QUORIDOR_DOCKER_MEMORY", "256m")
FORCE_SUBPROCESS = os.environ.get("QUORIDOR_NO_DOCKER", "") == "1"

_docker_ok: bool | None = None


def _check_docker() -> bool:
    """检测 docker 是否可用（含 image 是否存在）。"""
    global _docker_ok
    if FORCE_SUBPROCESS:
        return False
    if _docker_ok is not None:
        return _docker_ok
    try:
        r = subprocess.run(["docker", "info"], capture_output=True, timeout=5)
        _docker_ok = r.returncode == 0
    except Exception:
        _docker_ok = False
    return _docker_ok


def _meta_path(ai_dir: Path) -> Path:
    return ai_dir / "meta.json"


def list_ais() -> list[dict]:
    out = []
    if not DATA_DIR.exists():
        return out
    for d in sorted(DATA_DIR.iterdir()):
        if not d.is_dir():
            continue
        mp = _meta_path(d)
        if mp.exists():
            try:
                out.append(json.loads(mp.read_text(encoding="utf-8")))
            except Exception:
                continue
    return out


def get_ai(ai_id: str) -> dict | None:
    mp = DATA_DIR / ai_id / "meta.json"
    if not mp.exists():
        return None
    return json.loads(mp.read_text(encoding="utf-8"))


def build_example_zip() -> bytes:
    """打包示例 AI：example_ai.cpp + SDK 头 + README（不含 runner，平台自动加入）。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name in ("quoridor_sdk.h", "example_ai.cpp", "README.md"):
            p = SDK_DIR / name
            if p.exists():
                z.write(p, arcname=name)
    return buf.getvalue()


def _safe_extract(zip_bytes: bytes, dest: Path):
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        infos = z.infolist()
        if len(infos) > MAX_FILES:
            raise ValueError(f"文件过多（>{MAX_FILES}）")
        for info in infos:
            if info.is_dir():
                continue
            name = info.filename
            # 防 ZipSlip：拒绝绝对路径与 .. 跳出
            if name.startswith("/") or name.startswith("\\") or ".." in Path(name).parts:
                raise ValueError(f"非法路径：{name}")
            if info.file_size > 2 * 1024 * 1024:
                raise ValueError(f"单文件过大：{name}")
            suffix = Path(name).suffix.lower()
            if suffix not in ALLOWED_SUFFIX and suffix != "":
                # 允许无后缀？一律拒绝，保持简单
                raise ValueError(f"不允许的文件类型：{name}")
            target = dest / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)


def save_upload(zip_bytes: bytes, name: str) -> dict:
    if len(zip_bytes) > MAX_ZIP_BYTES:
        raise ValueError("zip 超过 5MB 上限")
    ai_id = uuid.uuid4().hex[:12]
    ai_dir = DATA_DIR / ai_id
    src_dir = ai_dir / "source"
    src_dir.mkdir(parents=True, exist_ok=True)
    try:
        _safe_extract(zip_bytes, src_dir)
    except zipfile.BadZipFile:
        shutil.rmtree(ai_dir, ignore_errors=True)
        raise ValueError("不是有效的 zip 文件")
    cpps = list(src_dir.rglob("*.cpp")) + list(src_dir.rglob("*.cc")) + list(src_dir.rglob("*.cxx"))
    if not cpps:
        shutil.rmtree(ai_dir, ignore_errors=True)
        raise ValueError("zip 内未找到 .cpp 文件")
    # 禁止用户自带 main（会与 runner.cpp 的 main 冲突）；若误带 runner.cpp 则忽略该文件
    for f in cpps:
        if f.name == "runner.cpp":
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if re.search(r"\bint\s+main\s*\(", text):
            shutil.rmtree(ai_dir, ignore_errors=True)
            raise ValueError(f"{f.name} 中不应定义 main()，只需实现 decide()（见示例）")
    meta = {
        "aiId": ai_id,
        "name": name or "unnamed",
        "files": sorted(str(p.relative_to(src_dir)) for p in src_dir.rglob("*") if p.is_file()),
        "status": "compiling",
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sandbox": "docker" if _check_docker() else "subprocess",
    }
    _meta_path(ai_dir).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    try:
        compile_ai(ai_id)
    except Exception as e:
        meta["status"] = "error"
        meta["error"] = str(e)
        _meta_path(ai_dir).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        raise
    meta = get_ai(ai_id)
    assert meta is not None
    return meta


def _user_sources(ai_dir: Path) -> list[str]:
    """用户源码（自动剔除误带的 runner.cpp，平台统一用 sdk/runner.cpp）。"""
    src_dir = ai_dir / "source"
    all_cpps = list(src_dir.rglob("*.cpp")) + list(src_dir.rglob("*.cc")) + list(src_dir.rglob("*.cxx"))
    return [str(p) for p in all_cpps if p.name != "runner.cpp"]


def _compile_cmd(ai_dir: Path, exe: Path) -> list[str]:
    cpps = _user_sources(ai_dir)
    runner = SDK_DIR / "runner.cpp"
    return ["g++", "-std=c++17", "-O2", "-o", str(exe), *cpps, str(runner), "-I", str(SDK_DIR)]


def compile_ai(ai_id: str) -> dict:
    ai_dir = DATA_DIR / ai_id
    if not ai_dir.exists():
        raise ValueError("AI 不存在")
    exe = ai_dir / "ai_exe"
    log_file = ai_dir / "compile.log"
    # 优先 Docker 内编译（保证运行 ABI 一致），失败则回退本地 g++
    use_docker = _check_docker()
    err_text = ""
    if use_docker:
        try:
            _docker_compile(ai_dir, exe)
            return _mark_ok(ai_id)
        except Exception as e:
            err_text = f"docker 编译失败，回退本地编译：{e}\n"
    cmd = _compile_cmd(ai_dir, exe)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=COMPILE_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise ValueError("编译超时（30s）")
    log = (err_text + "CMD: " + " ".join(cmd) + "\nSTDOUT:\n" + r.stdout + "\nSTDERR:\n" + r.stderr)
    log_file.write_text(log, encoding="utf-8")
    if r.returncode != 0:
        meta = get_ai(ai_id) or {"aiId": ai_id}
        meta.update({"status": "error", "error": (r.stderr or r.stdout)[-2000:]})
        _meta_path(ai_dir).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        raise ValueError("编译失败，详见 compile.log：" + (r.stderr or r.stdout)[-2000:])
    return _mark_ok(ai_id)


def _mark_ok(ai_id: str) -> dict:
    ai_dir = DATA_DIR / ai_id
    meta = get_ai(ai_id) or {"aiId": ai_id, "name": ai_id}
    meta.update({"status": "ready", "error": None})
    _meta_path(ai_dir).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta


def _docker_compile(ai_dir: Path, exe: Path):
    """在 gcc 镜像内编译，产物落到 ai_dir/ai_exe。"""
    # 把 sdk 与 source 都挂载进容器
    with tempfile.TemporaryDirectory() as tmp:
        # 编译产物先落临时目录再拷回，避免挂载权限问题
        cmd = [
            "docker", "run", "--rm",
            "--network", "none",
            "--memory", DOCKER_MEMORY,
            "-v", f"{ai_dir}:/work",
            "-v", f"{SDK_DIR}:/sdk:ro",
            DOCKER_IMAGE,
            "bash", "-c",
            "g++ -std=c++17 -O2 -o /work/ai_exe $(find /work/source \\( -name '*.cpp' -o -name '*.cc' \\) ! -name 'runner.cpp') /sdk/runner.cpp -I /sdk && chmod +x /work/ai_exe",
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=COMPILE_TIMEOUT)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout)[-2000:] or "docker 编译失败")
        if not exe.exists():
            raise RuntimeError("docker 编译未产出 ai_exe")


def _limit_resources():
    # 子进程资源限制：地址空间 512MB，CPU 5s（硬），禁 core dump
    try:
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    except Exception:
        pass


def run_ai(ai_id: str, state_dict: dict, timeout: float = 2.0) -> dict:
    """运行 AI 可执行文件，stdin 输入局面 JSON，stdout 解析为走法 JSON。"""
    ai_dir = DATA_DIR / ai_id
    exe = ai_dir / "ai_exe"
    if not exe.exists():
        raise ValueError("AI 未编译成功")
    payload = json.dumps(state_dict, ensure_ascii=False).encode("utf-8")
    if len(payload) > 256 * 1024:
        raise ValueError("局面 JSON 过大")
    timeout = max(0.5, min(float(timeout or 2.0), 10.0))
    stdout, sandbox = _run_exe(ai_dir, exe, payload, timeout)
    if len(stdout) > 64 * 1024:
        raise ValueError("AI 输出过大")
    try:
        mv = json.loads(stdout.decode("utf-8", errors="strict"))
    except Exception:
        raise ValueError(f"AI 输出不是合法 JSON：{stdout[:500]!r}")
    if not isinstance(mv, dict) or mv.get("type") not in ("move", "wall"):
        raise ValueError(f"AI 返回格式错误：{mv}")
    return {"move": mv, "sandbox": sandbox}


def _run_exe(ai_dir: Path, exe: Path, payload: bytes, timeout: float) -> tuple[bytes, str]:
    # 优先 Docker 沙箱运行
    if _check_docker():
        try:
            return _docker_run(ai_dir, payload, timeout), "docker"
        except Exception as e:
            # docker 运行失败（如镜像被删）则回退本地运行，并在 stderr 备注
            try:
                return _local_run(exe, payload, timeout), "subprocess(fallback)"
            except Exception as e2:
                raise ValueError(f"Docker 运行失败且本地回退也失败：{e} / {e2}")
    return _local_run(exe, payload, timeout), "subprocess"


def _local_run(exe: Path, payload: bytes, timeout: float) -> bytes:
    exe.chmod(0o755)
    try:
        r = subprocess.run(
            [str(exe)],
            input=payload,
            capture_output=True,
            timeout=timeout,
            preexec_fn=_limit_resources,
        )
    except subprocess.TimeoutExpired:
        raise ValueError(f"AI 超时（>{timeout}s）")
    if r.returncode != 0:
        raise ValueError(f"AI 异常退出（code={r.returncode}）：{(r.stderr or b'')[:500]!r}")
    return r.stdout.strip()


def _docker_run(ai_dir: Path, payload: bytes, timeout: float) -> bytes:
    cmd = [
        "docker", "run", "--rm", "-i",
        "--network", "none",
        "--memory", DOCKER_MEMORY,
        "--cpus", "0.5",
        "--pids-limit", "64",
        "-v", f"{ai_dir}:/work:ro",
        DOCKER_IMAGE,
        "/work/ai_exe",
    ]
    try:
        r = subprocess.run(cmd, input=payload, capture_output=True, timeout=timeout + 5)
    except subprocess.TimeoutExpired:
        raise ValueError(f"AI 超时（>{timeout}s，docker）")
    if r.returncode != 0:
        raise ValueError(f"AI(docker) 异常退出 code={r.returncode}：{r.stderr[:500]!r}")
    return r.stdout.strip()
