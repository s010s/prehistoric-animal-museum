#!/bin/zsh
# Rebuild the vendor characters from Microsoft Rocketbox (MIT, https://github.com/microsoft/Microsoft-Rocketbox).
# Needs: Blender 4.2+ (tested 5.2), ImageMagick, curl, gh (GitHub CLI) for listing texture files.
#   tools/characters/build.sh [workdir]
set -e
HERE=${0:A:h}; ROOT=${HERE:h:h}; WORK=${1:-/tmp/rocketbox}
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
mkdir -p $WORK && cd $WORK
# avatar : texture prefix : clip set (m / f) : output name
AVATARS=( "Professions/Wood_Male_01:m110:m:joe" "Adults/Female_Adult_04:f004:f:marta" )
CLIPS=( idle_neutral_01 idle_breathe_01 idle_look_around_01 gestic_talk_neutral_01 gestic_talk_relaxed_01 wave_01 gestic_shrug_01 )
: > files
for a in $AVATARS; do
	d=${a%%:*}; n=$(basename $d)
	echo "Assets/Avatars/$d/Export/$n.fbx" >> files
	gh api "repos/microsoft/Microsoft-Rocketbox/contents/Assets/Avatars/$d/Textures" --jq '.[].name' | sed "s#^#Assets/Avatars/$d/Textures/#" >> files
done
for c in $CLIPS; do for g in m f; do echo "Assets/Animations/all_animations_max_motextr_static/${g}_$c.max.fbx"; done; done >> files
echo LICENSE.md >> files
tr '\n' '\0' < files | xargs -0 -P 16 -n 1 $HERE/fetch.sh
mkdir -p $ROOT/public/models/characters
cp LICENSE.md $ROOT/public/models/characters/LICENSE-Rocketbox.md
for a in $AVATARS; do
	d=${a%%:*}; r=${a#*:}; p=${r%%:*}; r=${r#*:}; g=${r%%:*}; out=${r#*:}; n=$(basename $d)
	$HERE/textures.sh Assets/Avatars/$d/Textures tex/$p $p 1024
	$BLENDER -b --python $HERE/convert.py -- Assets/Avatars/$d/Export/$n.fbx tex/$p $p $ROOT/public/models/characters/$out.glb Assets/Animations/all_animations_max_motextr_static/${g}_*.fbx
done
