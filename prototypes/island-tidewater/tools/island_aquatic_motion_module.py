"""Serialize quantized Blender aquatic clips as lazy JavaScript modules."""

from base64 import b64encode
import json
import struct


def encode_motion(clips):
    packed = {}
    for name, clip in clips.items():
        tracks = packed[name] = dict(clip)
        for path in ("rotations", "auxiliary"):
            if path in clip:
                tracks[path] = {
                    joint: b64encode(struct.pack(f"<{len(values)}h", *values)).decode("ascii")
                    for joint, values in clip[path].items()
                }
    return "export default " + json.dumps(packed, separators=(",", ":")) + ";\n"
