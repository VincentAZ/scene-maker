"""Remove measured near-unit scale noise from a trusted, model-only GLB.
Keep each skin's rest deformation unchanged by correcting its inverse binds.
This is deliberately limited to bundled characters, never arbitrary imports.
"""
import json
import struct
from pathlib import Path
from mathutils import Matrix, Vector, Quaternion


def normalize_bind_scale(filepath):
    file = Path(filepath)
    data = file.read_bytes()
    json_length, json_type = struct.unpack_from("<II", data, 12)
    assert json_type == 0x4E4F534A
    document = json.loads(data[20:20 + json_length])
    assert not document.get("animations"), "Only model-only character exports can be normalized"
    binary_length, binary_type = struct.unpack_from("<II", data, 20 + json_length)
    assert binary_type == 0x004E4942
    binary = bytearray(data[28 + json_length:28 + json_length + binary_length])
    nodes = document["nodes"]
    parents = {child: index for index, node in enumerate(nodes) for child in node.get("children", [])}

    def world_matrices():
        result = {}
        def world(index):
            if index in result: return result[index]
            node = nodes[index]
            if "matrix" in node:
                local = Matrix([node["matrix"][i:i+4] for i in range(0, 16, 4)]).transposed()
            else:
                q = node.get("rotation", [0, 0, 0, 1])
                local = Matrix.LocRotScale(Vector(node.get("translation", [0, 0, 0])), Quaternion((q[3], *q[:3])), Vector(node.get("scale", [1, 1, 1])))
            result[index] = world(parents[index]) @ local if index in parents else local
            return result[index]
        for index in range(len(nodes)): world(index)
        return result

    before = world_matrices()
    joints = {joint for skin in document["skins"] for joint in skin["joints"]}
    for joint in joints:
        node = nodes[joint]
        assert "matrix" not in node, "Expected explicit bone transforms"
        assert all(abs(value - 1) < .0001 for value in node.get("scale", [1, 1, 1])), "Unexpected bind scale in a bundled character"
        node.pop("scale", None)
    after = world_matrices()
    processed = {}
    for skin in document["skins"]:
        key = skin["inverseBindMatrices"]
        if key in processed:
            assert processed[key] == skin["joints"], "Shared inverse binds need matching joints"
            continue
        processed[key] = skin["joints"]
        accessor = document["accessors"][skin["inverseBindMatrices"]]
        assert accessor["componentType"] == 5126 and accessor["type"] == "MAT4" and "sparse" not in accessor
        view = document["bufferViews"][accessor["bufferView"]]
        assert view.get("buffer", 0) == 0 and accessor["count"] == len(skin["joints"])
        offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        for index, joint in enumerate(skin["joints"]):
            location = offset + index * view.get("byteStride", 64)
            values = struct.unpack_from("<16f", binary, location)
            inverse = Matrix([values[i:i+4] for i in range(0, 16, 4)]).transposed()
            corrected = after[joint].inverted() @ before[joint] @ inverse
            struct.pack_into("<16f", binary, location, *(corrected[row][column] for column in range(4) for row in range(4)))
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    file.write_bytes(struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(binary)) + struct.pack("<II", len(encoded), json_type) + encoded + struct.pack("<II", len(binary), binary_type) + binary)
