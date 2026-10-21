import argparse
import getpass
import json
import logging
import os
import sys
import warnings
from pathlib import Path

from .storage import restore_backup, write_snapshot


def main() -> None:
    parser = argparse.ArgumentParser(description="Local research backend with manual provider pulls")
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve")
    serve.add_argument("--db", type=Path, default=Path(os.environ.get("ECONQUEST_DB_PATH", "research-data/research.sqlite3")))
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--prompt-fred-key", action="store_true", help="Read FRED_API_KEY at a hidden terminal prompt; never stores it in a file")
    serve.add_argument("--prompt-comtrade-key", action="store_true", help="Read COMTRADE_API_KEY at a hidden terminal prompt; never stores it in a file")
    serve.add_argument("--prompt-acled", action="store_true", help="Read myACLED email/password at hidden terminal prompts; memory only")
    backup = commands.add_parser("backup")
    backup.add_argument("--db", type=Path, required=True)
    backup.add_argument("--output", type=Path, required=True)
    restore = commands.add_parser("restore")
    restore.add_argument("--input", type=Path, required=True)
    restore.add_argument("--target", type=Path, required=True)
    restore.add_argument("--offline", action="store_true", help="Acknowledge that the target is offline; never overwrites")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if args.command == "serve":
        if args.prompt_fred_key:
            if not sys.stdin.isatty():
                parser.exit(1, "Hidden FRED key entry requires an interactive terminal.\n")
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", getpass.GetPassWarning)
                    value = getpass.getpass("FRED API key (hidden; paste here, not in chat): ")
            except (getpass.GetPassWarning, EOFError, KeyboardInterrupt):
                parser.exit(1, "Hidden FRED key entry unavailable or cancelled; backend not started.\n")
            from .fred import AcquisitionError, api_key
            os.environ["FRED_API_KEY"] = value
            try:
                api_key()
            except AcquisitionError:
                parser.exit(1, "FRED key must be 32 lowercase letters/digits; backend not started.\n")
        if args.prompt_comtrade_key:
            if not sys.stdin.isatty():
                parser.exit(1, "Hidden Comtrade key entry requires an interactive terminal.\n")
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", getpass.GetPassWarning)
                    value = getpass.getpass("Comtrade subscription key (hidden; paste here, not in chat): ")
            except (getpass.GetPassWarning, EOFError, KeyboardInterrupt):
                parser.exit(1, "Hidden Comtrade key entry unavailable or cancelled; backend not started.\n")
            from .comtrade import AcquisitionError, api_key
            os.environ["COMTRADE_API_KEY"] = value
            try:
                api_key()
            except AcquisitionError:
                parser.exit(1, "Comtrade key format invalid; backend not started.\n")
        if args.prompt_acled:
            if not sys.stdin.isatty():
                parser.exit(1, "Hidden ACLED credential entry requires an interactive terminal.\n")
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", getpass.GetPassWarning)
                    username = getpass.getpass("myACLED email (hidden; enter here, not in chat): ")
                    password = getpass.getpass("myACLED password (hidden; enter here, not in chat): ")
            except (getpass.GetPassWarning, EOFError, KeyboardInterrupt):
                parser.exit(1, "Hidden ACLED entry unavailable or cancelled; backend not started.\n")
            from .acled import AcquisitionError, credentials
            os.environ["ACLED_USERNAME"], os.environ["ACLED_PASSWORD"] = username, password
            try:
                credentials()
            except AcquisitionError:
                parser.exit(1, "ACLED credentials are missing/invalid; backend not started.\n")
        import uvicorn
        from .app import create_app
        # Fixed loopback binding is intentional; there is no public-host switch.
        uvicorn.run(create_app(args.db), host="127.0.0.1", port=args.port, access_log=False)
        return
    try:
        if args.command == "backup":
            write_snapshot(args.db, args.output)
        else:
            restore_backup(args.input, args.target, offline=args.offline)
    except Exception as exc:
        parser.exit(1, f"{json.dumps({'event': 'operation_failed', 'errorType': type(exc).__name__})}\n")
    print(json.dumps({"event": f"{args.command}_complete"}))


if __name__ == "__main__":
    main()
