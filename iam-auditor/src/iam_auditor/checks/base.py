from abc import ABC, abstractmethod
from collections.abc import Iterator
from typing import Any

from ..models import Finding


class Check(ABC):
    check_id: str
    title: str

    @abstractmethod
    def run(self, iam_client: Any) -> Iterator[Finding]: ...
