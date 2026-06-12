import os

from app import api


def main():
    api.run(address=os.environ.get("HOST", "127.0.0.1"),
            port=int(os.environ.get("PORT", "5042")))


if __name__ == "__main__":
    main()
