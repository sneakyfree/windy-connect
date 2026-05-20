"""Allow `python -m windy_connect` to invoke the CLI."""

from .cli import app

if __name__ == "__main__":
    app()
