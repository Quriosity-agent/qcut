"""Read the small documented MediaPipe metadata subset without copying bindings."""

import struct


def segmentation_metadata(*, model) -> dict:
    import flatbuffers.number_types as numbers
    from flatbuffers.table import Table

    def tables(*, table, field):
        offset = table.Offset(4 + 2 * field)
        if not offset:
            return []
        count = table.VectorLen(offset)
        if count > 128:
            raise ValueError("Metadata table vector exceeds bounds")
        return [
            Table(table.Bytes, table.Indirect(table.Vector(offset) + index * 4))
            for index in range(count)
        ]

    def child(*, table, field):
        offset = table.Offset(4 + 2 * field)
        if not offset:
            raise ValueError("Required metadata table is missing")
        return Table(table.Bytes, table.Indirect(table.Pos + offset))

    def vector(*, table, field, dtype):
        offset = table.Offset(4 + 2 * field)
        if not offset:
            raise ValueError("Required metadata vector is missing")
        return table.GetVectorAsNumpy(dtype, offset)

    for index in range(model.MetadataLength()):
        entry = model.Metadata(index)
        if entry.Name() != b"TFLITE_METADATA":
            continue
        raw = bytes(model.Buffers(entry.Buffer()).DataAsNumpy())
        if not 8 <= len(raw) <= 65536 or raw[4:8] != b"M001":
            raise ValueError("Unsupported MediaPipe metadata")
        root = Table(raw, struct.unpack_from("<I", raw)[0])
        graphs = tables(table=root, field=3)
        if len(graphs) != 1:
            raise ValueError("Expected one metadata subgraph")
        graph = graphs[0]
        inputs = tables(table=graph, field=2)
        if len(inputs) != 1:
            raise ValueError("Expected one metadata input")
        result = {}
        for process in tables(table=inputs[0], field=4):
            offset = process.Offset(4)
            kind = (
                process.Get(numbers.Uint8Flags, process.Pos + offset) if offset else 0
            )
            if kind != 1:
                raise ValueError("Unverified input preprocessing metadata")
            options = child(table=process, field=1)
            result["normalization"] = {
                "mean": vector(
                    table=options, field=0, dtype=numbers.Float32Flags
                ).tolist(),
                "std": vector(
                    table=options, field=1, dtype=numbers.Float32Flags
                ).tolist(),
            }
        for custom in tables(table=graph, field=9):
            offset = custom.Offset(4)
            if (
                not offset
                or custom.String(custom.Pos + offset) != b"SEGMENTER_METADATA"
            ):
                continue
            raw_options = bytes(vector(table=custom, field=1, dtype=numbers.Uint8Flags))
            if len(raw_options) < 8 or raw_options[4:8] != b"V001":
                raise ValueError("Unsupported segmenter metadata version")
            options = Table(raw_options, struct.unpack_from("<I", raw_options)[0])
            offset = options.Offset(4)
            activation = (
                options.Get(numbers.Uint8Flags, options.Pos + offset) if offset else 0
            )
            if activation not in {0, 1, 2}:
                raise ValueError("Unknown output activation")
            result["output_activation"] = {0: "NONE", 1: "SIGMOID", 2: "SOFTMAX"}[
                activation
            ]
        return result
    return {}
