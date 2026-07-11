.PHONY: dev server web test build

dev:
	docker compose up --build

server:
	cd apps/server && uv run uvicorn magical_athlete.main:app --reload

web:
	cd apps/web && npm run dev

test:
	cd apps/server && uv run pytest
	cd apps/web && npm run test

build:
	cd apps/web && npm run build

