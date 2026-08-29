import asyncio
import websockets
import sys

async def main():
    url = "ws://localhost:8000/reconstruction/ws"
    print(f"Connecting to {url}...")
    try:
        async with websockets.connect(url) as websocket:
            print("Connected successfully!")
            await websocket.send('{"job_id": "test"}')
            response = await websocket.recv()
            print("Response:", response)
    except Exception as e:
        print("Connection failed:", e, file=sys.stderr)

if __name__ == "__main__":
    asyncio.run(main())
