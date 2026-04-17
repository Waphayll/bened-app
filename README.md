# Bened App

React + Vite frontend with a FastAPI OCR backend.

## Project Structure

- Frontend: `src/`
- Backend: `bakcend/main.py`

## Frontend Setup

1. Install dependencies:

```bash
npm install
```

2. Configure Appwrite environment variables in `.env.local`:

```bash
VITE_APPWRITE_ENDPOINT=https://<YOUR_APPWRITE_HOST>
VITE_APPWRITE_PROJECT_ID=<YOUR_PROJECT_ID>
```

3. Run the app:

```bash
npm run dev
```

## Appwrite Notes

- Login uses Appwrite email/password sessions.
- In Appwrite Console, add your frontend origin (for example `http://localhost:5173`) as a Web platform for this project.
- Make sure CORS/allowed domains include your local and deployed frontend URLs.

## Backend

Run the OCR API with your Python environment:

```bash
uvicorn bakcend.main:app --reload --port 8000
```
