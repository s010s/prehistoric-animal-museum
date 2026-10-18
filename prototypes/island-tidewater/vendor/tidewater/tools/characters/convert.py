# Blender (4.2+ / 5.x) batch converter (see README): Rocketbox avatar FBX + clip FBXs -> one GLB (skin + clips).
# blender -b --python convert.py -- <avatar.fbx> <texdir (prepared jpg/png)> <prefix m106> <out.glb> <anim1.fbx> [anim2.fbx ...]
import bpy, sys, os
argv = sys.argv[sys.argv.index('--') + 1:]
avatar, texdir, prefix, out = argv[:4]
anims = argv[4:]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, automatic_bone_orientation=False, ignore_leaf_bones=False)
    return [o for o in bpy.data.objects if o not in before]

objs = import_fbx(avatar)
arm = next(o for o in objs if o.type == 'ARMATURE')
mesh = next(o for o in objs if o.type == 'MESH')
for o in objs:
    if o.type == 'EMPTY': bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
arm.name = 'Avatar'
mesh.name = 'AvatarMesh'

# ---- materials: base colour, normal, ORM (G = roughness from the specular map), opacity cards
def img(name):
    p = os.path.join(texdir, name)
    return bpy.data.images.load(p) if os.path.exists(p) else None

for slot in mesh.material_slots:
    m = slot.material
    kind = m.name.split('_')[-1]  # body / head / opacity
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    outn = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], outn.inputs['Surface'])
    if kind == 'opacity':
        im = img(f'{prefix}_opacity.png')
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = im
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
        bsdf.inputs['Roughness'].default_value = 0.6
        m.name = 'opacity'
        continue
    c = nt.nodes.new('ShaderNodeTexImage'); c.image = img(f'{prefix}_{kind}_color.jpg')
    nt.links.new(c.outputs['Color'], bsdf.inputs['Base Color'])
    n = nt.nodes.new('ShaderNodeTexImage'); n.image = img(f'{prefix}_{kind}_normal.jpg')
    if n.image: n.image.colorspace_settings.name = 'Non-Color'
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    o = nt.nodes.new('ShaderNodeTexImage'); o.image = img(f'{prefix}_{kind}_orm.jpg')
    if o.image: o.image.colorspace_settings.name = 'Non-Color'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(o.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    m.name = kind

# ---- animations: retargeted by bone name in world space. The clips' skeleton has its own rest
# pose (arms down) while the avatars rest in a T-pose, so local rotations can't be copied: every
# avatar bone copies its clip bone's world orientation (the pelvis also its position) and the
# result is baked (visual keying) into one action per clip.
bone_names = set(b.name for b in arm.data.bones)
arm.animation_data_create()
view_layer = bpy.context.view_layer
for path in anims:
    clip = os.path.basename(path).split('.')[0]  # m_idle_neutral_01
    clip = clip[2:] if clip[:2] in ('m_', 'f_') else clip
    new = import_fbx(path)
    a_arm = next((o for o in new if o.type == 'ARMATURE'), None)
    act = a_arm.animation_data.action if a_arm and a_arm.animation_data else None
    if act is None:
        print('NO ACTION', path)
        continue
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    cons = []
    for pb in arm.pose.bones:
        if pb.name not in a_arm.pose.bones: continue
        c = pb.constraints.new('COPY_ROTATION'); c.target = a_arm; c.subtarget = pb.name
        c.owner_space = 'WORLD'; c.target_space = 'WORLD'; cons.append(c)
        if pb.name == 'Bip01 Pelvis':
            c2 = pb.constraints.new('COPY_LOCATION'); c2.target = a_arm; c2.subtarget = pb.name
            c2.owner_space = 'WORLD'; c2.target_space = 'WORLD'; cons.append(c2)
    for o in view_layer.objects: o.select_set(False)
    arm.select_set(True); view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    arm.animation_data.action = None
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, only_selected=True, visual_keying=True, clear_constraints=True,
                     use_current_action=False, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    baked = arm.animation_data.action
    baked.name = clip
    baked.use_fake_user = True
    arm.animation_data.action = None
    for o in new:
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if isinstance(data, bpy.types.Armature): bpy.data.armatures.remove(data)
    bpy.data.actions.remove(act)
    tr = arm.animation_data.nla_tracks.new(); tr.name = clip
    st = tr.strips.new(clip, f0, baked)
    if hasattr(st, 'action_slot') and baked.slots: st.action_slot = baked.slots[0]
    tr.mute = True
    print('BAKED', clip, f0, f1)
# drop the other imported clip actions (footsteps / motion helper)
for a in list(bpy.data.actions):
    if not a.use_fake_user: bpy.data.actions.remove(a)
arm.animation_data.action = None

bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_image_format='AUTO', export_jpeg_quality=88,
    export_skins=True, export_animations=True, export_animation_mode='NLA_TRACKS',
    export_force_sampling=True, export_optimize_animation_size=True, export_def_bones=False,
    export_morph=False, export_yup=True, export_apply=False, export_cameras=False, export_lights=False,
)
print('EXPORTED', out, os.path.getsize(out))
