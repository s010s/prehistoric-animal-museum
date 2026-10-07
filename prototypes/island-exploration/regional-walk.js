// Review path only. The v2 ecology/path mask in sample-region.js stays fixed.
// v7 uses bidirectional fine edges and snaps each requested anchor within 6m to its closest reachable node.
// A blocked final chord reuses only previously traversed, checked edges.
// The follower walks each checked edge without corner chords or late-frame catchup.
// The loop closes at the actual start; ordinary slope/rock/water rules remain.
export const WALK_ROUTE={id:'side-spring-loop',version:'side-spring-walk-v7',
 anchors:[[-2047,-714],[-2042,-714],[-2037,-709],[-2030,-691],[-2012,-676],[-1994,-675],[-1989,-668],[-1990,-651],[-1981,-625],[-1979,-586],[-1983,-564],[-1978,-549],[-1964,-546],[-1957,-566],[-1968,-590],[-1989,-625],[-1989,-662],[-1993,-672],[-2012,-675],[-2028,-681],[-2030,-691],[-2037,-709],[-2042,-714],[-2047,-714]]};
