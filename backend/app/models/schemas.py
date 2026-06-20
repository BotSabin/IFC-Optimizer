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
    target_schema: str = Field(default="IFC2X3", pattern="^(IFC2X3|IFC4|IFC4X3)$")


class GeometryMesh(BaseModel):
    step_id: int
    global_id: str | None = None
    name: str | None = None
    class_name: str
    color: str
    positions: list[float]
    indices: list[int]


class GeometryResponse(BaseModel):
    project_id: str
    source: str
    generated: bool
    mesh_count: int
    limit: int
    meshes: list[GeometryMesh]


class ElementPropertiesResponse(BaseModel):
    project_id: str
    step_id: int
    class_name: str
    name: str | None = None
    global_id: str | None = None
    type_name: str | None = None
    container: str | None = None
    property_sets: dict[str, dict[str, str]]


class ElementGeometryResponse(BaseModel):
    project_id: str
    step_id: int
    meshes: list[GeometryMesh]
