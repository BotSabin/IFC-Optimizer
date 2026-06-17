from pydantic import BaseModel, Field


class ClassStat(BaseModel):
    name: str
    count: int
    geometry: int
    triangles: int


class AnalysisResult(BaseModel):
    schema: str
    total_entities: int
    total_products: int
    total_ifc_classes: int
    file_size: int
    geometry_count: int
    triangle_count: int
    property_count: int
    quantity_count: int
    classes: list[ClassStat]


class ProjectRead(BaseModel):
    id: str
    filename: str
    file_size: int
    schema: str | None
    status: str
    analysis: AnalysisResult | None = None

    model_config = {"from_attributes": True}


class UploadResponse(BaseModel):
    project: ProjectRead
    analysis_task_id: str


class TaskRead(BaseModel):
    id: str
    project_id: str
    kind: str
    status: str
    progress: int = Field(ge=0, le=100)
    logs: list[str]
    result: dict | None = None

    model_config = {"from_attributes": True}


class OptimizeRequest(BaseModel):
    mode: str = Field(pattern="^(safe|medium|aggressive)$")


class DeleteClassesRequest(BaseModel):
    classes: list[str]


class ExportRequest(BaseModel):
    classes: list[str] | None = None
    element_ids: list[int] | None = None

