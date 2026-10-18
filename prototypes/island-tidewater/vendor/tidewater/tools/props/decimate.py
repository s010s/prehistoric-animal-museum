# Blender: decimate the downloaded prop models to a triangle budget (keeps UVs / normals / materials).
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/props/decimate.py
# Reads tools/props/.raw/mod/<name>/<name>.gltf, writes tools/props/.raw/dec/<name>/<name>.gltf (+ .bin);
# textures are taken from the original folder by build.mjs.
import bpy, os, sys
HERE = os.path.dirname( os.path.abspath( __file__ ) )
RAW = os.environ.get( 'RAW', os.path.join( HERE, '.raw' ) )
BUDGET = {
	'wooden_crate_02': 3500, 'wooden_crate_01': 3500, 'wooden_bucket_01': 3000, 'fish_knife': 1500, 'wooden_cutting_board': 1500,
	'lifebuoy': 3500, 'wooden_lantern_01': 4000, 'fishermans_hat': 3000, 'WoodenTable_03': 2400, 'metal_jerrycan_green': 3500,
	'plastic_jerrycan': 3000, 'life_jacket': 4000, 'metal_toolbox': 4500, 'wooden_display_shelves_01': 3200,
}
for name, budget in BUDGET.items():
	bpy.ops.wm.read_factory_settings( use_empty = True )
	bpy.ops.import_scene.gltf( filepath = os.path.join( RAW, 'mod', name, name + '.gltf' ) )
	meshes = [ o for o in bpy.context.scene.objects if o.type == 'MESH' ]
	tris = sum( sum( len( p.vertices ) - 2 for p in o.data.polygons ) for o in meshes )
	ratio = min( 1.0, budget / max( tris, 1 ) )
	if ratio < 0.98:
		for o in meshes:
			m = o.modifiers.new( 'dec', 'DECIMATE' )
			m.ratio = ratio
			m.use_collapse_triangulate = True
			bpy.context.view_layer.objects.active = o
			bpy.ops.object.modifier_apply( modifier = 'dec' )
	out = os.path.join( RAW, 'dec', name )
	os.makedirs( out, exist_ok = True )
	bpy.ops.export_scene.gltf( filepath = os.path.join( out, name + '.gltf' ), export_format = 'GLTF_SEPARATE', export_texcoords = True, export_normals = True, export_materials = 'PLACEHOLDER', export_image_format = 'NONE', export_yup = True )
	after = sum( sum( len( p.vertices ) - 2 for p in o.data.polygons ) for o in meshes )
	print( 'DECIMATED', name, tris, '->', after )
