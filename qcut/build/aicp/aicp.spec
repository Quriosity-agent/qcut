# PyInstaller spec for bundling the AICP CLI as a standalone executable.
from pathlib import Path

block_cipher = None
project_root = Path(__file__).resolve().parent
entry_script = project_root / "entry.py"

a = Analysis(
    [str(entry_script)],
    pathex=[str(project_root)],
    binaries=[],
    datas=[],
    hiddenimports=[
        "ai_content_pipeline",
        "ai_content_pipeline.cli",
        "fal_client",
        "pydantic",
        "httpx",
        "certifi",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "pytest",
        "torch",
        "numpy",
        "whisper",
        "boto3",
        "modal",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="aicp",
    debug=False,
    bootloader_ignore_signals=False,
    strip=True,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
