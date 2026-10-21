from typing import Literal

from pydantic import BaseModel, ConfigDict

Kind = Literal["annual", "market"]
Status = Literal["staged", "quarantined", "committed", "rolled_back", "interrupted"]

ANNUAL_FEATURES = (
    "externalDebtGni",
    "shortTermDebtReserves",
    "reservesMonths",
    "gdpGrowth",
    "inflation",
    "currentAccountGdp",
)
COUNTRIES = frozenset({"CHL", "BLZ", "LKA", "ARG", "TUR", "GHA", "IDN", "PAK", "ZAF"})


class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    country: str | None = None
    year: int | None = None
    inDefault: bool | None = None
    values: list[float | None] | None = None
    symbol: str | None = None
    observedAt: str | None = None
    value: float | None = None
    publishedAt: str | None


class Dataset(BaseModel):
    id: str
    version: str
    kind: Kind
    source: str
    unit: str
    createdAt: str
    freshnessDays: int | None
    observations: list[Observation]
    active: bool
    sessionPolicy: dict | None = None
    providerReport: dict | None = None


class Run(BaseModel):
    id: str
    status: Status
    createdAt: str
    source: str
    kind: Kind
    errors: list[str]
    datasetId: str | None
    rowCount: int


class State(BaseModel):
    schemaVersion: Literal[1] = 1
    datasets: list[Dataset]
    runs: list[Run]
    providers: list[dict]
    macro: list[dict] = []
    weo: list[dict] = []
    worldbank: list[dict] = []
    fred: list[dict] = []
    bis: list[dict] = []
    ids: list[dict] = []
    comtrade: list[dict] = []
    gdelt: list[dict] = []
    acled: list[dict] = []


class ImportPreview(BaseModel):
    run: Run
    preview: list[Observation]
    sheets: list[str]
    providerReport: dict | None = None
