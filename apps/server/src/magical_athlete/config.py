from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MAGICAL_ATHLETE_")

    app_name: str = "Magical Athlete Server"
    allowed_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "https://xeonliu.github.io",
    ]
    room_code_length: int = 4


settings = Settings()
