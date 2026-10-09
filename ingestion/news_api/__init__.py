from .service import poll_news
from .models import NewsQueryFilters, ContentItem, NewsApiError, SortBy, SearchField
from .client import NewsApiGateway
from .entity_match import EntityAlias

__all__ = [
    "poll_news",
    "NewsQueryFilters",
    "ContentItem",
    "NewsApiError",
    "SortBy",
    "SearchField",
    "NewsApiGateway",
    "EntityAlias",
]
