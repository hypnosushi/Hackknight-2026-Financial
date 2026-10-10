"""`/stocks` router: on-demand stock price lookups via ingestion/alpaca."""

from fastapi import APIRouter, Depends, HTTPException

from backend.api.deps import get_alpaca_gateway
from backend.ingestion.alpaca import (
    AlpacaApiError,
    AlpacaApiGateway,
    PricePoint,
    ZoomTier,
    fetch_price_series,
)

router = APIRouter(prefix="/stocks", tags=["stocks"])


@router.get("/{ticker}/prices", response_model=list[PricePoint])
def get_prices(
    ticker: str,
    tier: ZoomTier = ZoomTier.DAILY,
    gateway: AlpacaApiGateway = Depends(get_alpaca_gateway),
) -> list[PricePoint]:
    try:
        return fetch_price_series(ticker.upper(), tier, gateway)
    except AlpacaApiError as exc:
        raise HTTPException(status_code=502 if exc.retryable else 400, detail=exc.message) from exc
