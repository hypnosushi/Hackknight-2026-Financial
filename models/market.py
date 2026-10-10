from datetime import datetime

from sqlalchemy import DateTime, Text, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class Market(Base):
    """Prediction-market metadata. One row per market, upserted on every discovery."""

    __tablename__ = "markets"

    source: Mapped[str] = mapped_column(Text, primary_key=True, server_default="kalshi")
    market_id: Mapped[str] = mapped_column(Text, primary_key=True)  # Kalshi ticker
    title: Mapped[str | None] = mapped_column(Text)
    yes_sub_title: Mapped[str | None] = mapped_column(Text)
    rules_primary: Mapped[str | None] = mapped_column(Text)
    event_ticker: Mapped[str | None] = mapped_column(Text)
    event_title: Mapped[str | None] = mapped_column(Text)
    series: Mapped[str | None] = mapped_column(Text)
    series_title: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    status: Mapped[str] = mapped_column(Text, server_default="active")  # 'active' | 'closed'
    close_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
