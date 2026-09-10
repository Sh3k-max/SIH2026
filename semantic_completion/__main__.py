"""
Package entrypoint allowing: python -m semantic_completion --input ...
"""

from .completion_engine import main

if __name__ == "__main__":
    main()
