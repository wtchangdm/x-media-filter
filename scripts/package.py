#!/usr/bin/env python3
"""Create a deterministic review ZIP using only Python's standard library."""
import hashlib
import io
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = (
    "bridge.js", "content.css", "content.js",
    "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png",
    "manifest.json", "player.css", "player.html", "player.js", "policy.js",
    "popup.css", "popup.html", "popup.js", "rules.json", "worker.js",
)
source = ROOT / "extension"
# Chrome writes _metadata into an unpacked directory; it is never distributable source.
actual = set()
for path in source.rglob("*"):
    relative = path.relative_to(source)
    if path.is_symlink():
        raise SystemExit(f"Refusing symlink: {relative}")
    if path.is_file() and relative.parts[0] != "_metadata" and path.name != ".DS_Store":
        actual.add(relative.as_posix())
if actual != set(RUNTIME):
    raise SystemExit(f"Runtime inventory changed; review the allowlist. Missing: {set(RUNTIME) - actual}; extra: {actual - set(RUNTIME)}")

manifest = json.loads((source / "manifest.json").read_text())
assert manifest["manifest_version"] == 3
assert set(manifest["permissions"]) == {"storage", "declarativeNetRequest"}
assert set(manifest["host_permissions"]) == {
    "https://x.com/*", "https://*.x.com/*", "https://pbs.twimg.com/*", "https://video.twimg.com/*",
}
assert len(manifest["description"]) <= 132
assert manifest["name"] == "X Media Filter"
version = manifest["version"]
assert all(part.isdecimal() for part in version.split("."))

buffer = io.BytesIO()
entries = []
with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in sorted((*RUNTIME, "LICENSE")):
        data = (ROOT / "LICENSE" if name == "LICENSE" else source / name).read_bytes()
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, data, compresslevel=9)
        entries.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

payload = buffer.getvalue()
with zipfile.ZipFile(io.BytesIO(payload)) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == {*RUNTIME, "LICENSE"}
    assert json.loads(archive.read("manifest.json")) == manifest
    for entry in entries:
        assert hashlib.sha256(archive.read(entry["path"])).hexdigest() == entry["sha256"]

output = ROOT / "artifacts" / "release"
output.mkdir(parents=True, exist_ok=True)
name = f"x-media-filter-{version}.zip"
digest = hashlib.sha256(payload).hexdigest()
(output / name).write_bytes(payload)
(output / "SHA256SUMS").write_text(f"{digest}  {name}\n")
report = {
    "status": "local-review-candidate-not-submitted",
    "archive": name, "sha256": digest, "bytes": len(payload),
    "version": version, "minimum_chrome_version": manifest["minimum_chrome_version"],
    "permissions": manifest["permissions"], "host_permissions": manifest["host_permissions"],
    "files": entries,
}
(output / "package-report.json").write_text(json.dumps(report, indent=2) + "\n")
print(f"PASS: {len(RUNTIME)} runtime files + MIT LICENSE; ZIP CRC, inventory and source hashes verified")
print(f"artifacts/release/{name} ({len(payload)} bytes)\nSHA256 {digest}")
