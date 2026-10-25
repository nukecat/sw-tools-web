use sw_formats::{
    catalog::{BlockCatalog, BlockKind, CustomDataKind, MapCatalog, MapPropCategory},
    structure::{Structure, StructureWriteOptions},
};
use sw_tools::{insert_data, mesh, music_player, parsers, pixel_art, render};
use wasm_bindgen::prelude::*;

fn err<E: std::fmt::Display>(e: E) -> JsValue {
    JsValue::from_str(&e.to_string())
}

fn bytes(s: &Structure) -> Result<Box<[u8]>, JsValue> {
    s.to_bytes(&StructureWriteOptions::default())
        .map(Vec::into_boxed_slice)
        .map_err(err)
}

/// Resolves a block by name or numeric ID. `custom_only` restricts to custom-shape blocks.
fn resolve_block(spec: &str, custom_only: bool) -> Result<i32, JsValue> {
    if custom_only {
        parsers::custom_block(spec)
    } else {
        parsers::not_a_tool(spec)
    }
    .map_err(err)
}

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[wasm_bindgen]
pub fn music_player(
    midi: &[u8],
    min_pitch: u8,
    max_pitch: u8,
    min_velocity: u8,
    repeat: bool,
    include_drums: bool,
    display: bool,
    title: String,
) -> Result<Box<[u8]>, JsValue> {
    let s = music_player::generate(
        midi,
        &music_player::Options {
            min_pitch,
            max_pitch,
            min_velocity,
            repeat,
            include_drums,
            display,
            title,
            ..Default::default()
        },
    )
    .map_err(err)?;
    bytes(&s)
}

#[wasm_bindgen]
pub fn pixel_art(image: &[u8], block: &str, spacing: f32, state: f32) -> Result<Box<[u8]>, JsValue> {
    let id = resolve_block(block, false)?;
    let s = pixel_art::generate(image, id, spacing, state).map_err(err)?;
    bytes(&s)
}

/// Result of a mesh conversion: the structure bytes plus conversion stats.
#[wasm_bindgen]
pub struct MeshResult {
    data: Vec<u8>,
    pub triangles: usize,
    pub blocks: usize,
    pub merged_quads: usize,
}

#[wasm_bindgen]
impl MeshResult {
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Box<[u8]> {
        self.data.clone().into_boxed_slice()
    }
}

#[wasm_bindgen]
pub fn mesh(
    model: &[u8],
    wireframe: bool,
    thickness: f32,
    block: &str,
    paint: bool,
    merge_angle: f32,
    scale: f32,
    mirror: &str,
) -> Result<MeshResult, JsValue> {
    let opts = mesh::Options {
        mode: if wireframe { mesh::Mode::Wireframe } else { mesh::Mode::Hollow },
        thickness,
        block: resolve_block(block, true)?,
        color: if paint { mesh::ColorMode::Auto } else { mesh::ColorMode::None },
        merge_angle,
        scale,
        mirror: match mirror {
            "z" => mesh::Mirror::Z,
            "none" => mesh::Mirror::None,
            _ => mesh::Mirror::X,
        },
    };
    let (s, stats) = mesh::generate(model, None, &opts).map_err(err)?;
    Ok(MeshResult {
        data: bytes(&s)?.into_vec(),
        triangles: stats.triangles,
        blocks: stats.blocks,
        merged_quads: stats.merged_quads,
    })
}

#[wasm_bindgen]
pub fn insert_data(
    structure: &[u8],
    binary: &[u8],
    name: Option<String>,
    magic: Option<String>,
) -> Result<Box<[u8]>, JsValue> {
    let mut s = Structure::from_bytes(structure).map_err(err)?;
    let blob = match magic.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        Some(m) => Some(sw_tools::hex::decode(m).map_err(err)?),
        None => None,
    };
    let name = name.filter(|n| !n.trim().is_empty());
    insert_data::insert_data(&mut s, binary, insert_data::Filter { name, blob }).map_err(err)?;
    bytes(&s)
}

/// All blocks as a JSON array: [{id, name, kind, stateless, custom_shape, custom_data}].
#[wasm_bindgen]
pub fn block_catalog() -> String {
    let rows: Vec<serde_json::Value> = BlockCatalog::shared()
        .iter()
        .map(|b| {
            serde_json::json!({
                "id": b.id,
                "name": b.name,
                "kind": match b.kind { BlockKind::Block => "Block", BlockKind::Part => "Part", BlockKind::Tool => "Tool" },
                "stateless": b.stateless,
                "custom_shape": b.custom_shape,
                "custom_data": match b.custom_data {
                    CustomDataKind::None => "None",
                    CustomDataKind::Math => "Math",
                    CustomDataKind::Microcontroller => "Microcontroller",
                },
            })
        })
        .collect();
    serde_json::Value::Array(rows).to_string()
}

/// Triangle mesh of a structure for drawing. Typed arrays are copied out on access.
#[wasm_bindgen]
pub struct Preview {
    mesh: render::Mesh,
}

#[wasm_bindgen]
impl Preview {
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Box<[f32]> { self.mesh.positions.clone().into_boxed_slice() }
    #[wasm_bindgen(getter)]
    pub fn normals(&self) -> Box<[f32]> { self.mesh.normals.clone().into_boxed_slice() }
    #[wasm_bindgen(getter)]
    pub fn colors(&self) -> Box<[u8]> { self.mesh.colors.clone().into_boxed_slice() }
    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Box<[u32]> { self.mesh.indices.clone().into_boxed_slice() }
    #[wasm_bindgen(getter)]
    pub fn blocks(&self) -> usize { self.mesh.blocks }
    #[wasm_bindgen(getter)]
    pub fn custom_shaped(&self) -> usize { self.mesh.custom_shaped }
    #[wasm_bindgen(getter)]
    pub fn triangles(&self) -> usize { self.mesh.triangle_count() }
    /// [minX, minY, minZ, maxX, maxY, maxZ], or empty for an empty structure.
    #[wasm_bindgen(getter)]
    pub fn bounds(&self) -> Box<[f32]> {
        match self.mesh.bounds() {
            Some((lo, hi)) => vec![lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]].into_boxed_slice(),
            None => Box::new([]),
        }
    }
}

/// Parses a `.structure` file and builds its preview mesh.
#[wasm_bindgen]
pub fn preview(structure: &[u8]) -> Result<Preview, JsValue> {
    let s = Structure::from_bytes(structure).map_err(err)?;
    Ok(Preview { mesh: render::build(&s) })
}

/// The sound the generated music player makes, for previewing: one sine wave per tone generator
/// that is switched on and off, nothing else. Times are in milliseconds, on the game's ticks.
#[wasm_bindgen]
pub struct Playback {
    inner: music_player::Playback,
}

#[wasm_bindgen]
impl Playback {
    /// Hz of each tone generator, lowest first.
    #[wasm_bindgen(getter)]
    pub fn frequencies(&self) -> Box<[f32]> { self.inner.frequencies.clone().into_boxed_slice() }
    #[wasm_bindgen(getter)]
    pub fn event_ms(&self) -> Box<[u32]> {
        self.inner.events.iter().map(|e| e.ms.min(u32::MAX as u64) as u32).collect()
    }
    #[wasm_bindgen(getter)]
    pub fn event_tone(&self) -> Box<[u16]> {
        self.inner.events.iter().map(|e| e.tone as u16).collect()
    }
    /// 1 = tone generator switched on, 0 = off.
    #[wasm_bindgen(getter)]
    pub fn event_on(&self) -> Box<[u8]> {
        self.inner.events.iter().map(|e| e.on as u8).collect()
    }
    #[wasm_bindgen(getter)]
    pub fn total_ms(&self) -> u32 { self.inner.total_ms.min(u32::MAX as u64) as u32 }
}

#[wasm_bindgen]
pub fn music_playback(
    midi: &[u8],
    min_pitch: u8,
    max_pitch: u8,
    min_velocity: u8,
    include_drums: bool,
) -> Result<Playback, JsValue> {
    let inner = music_player::playback(
        midi,
        &music_player::Options {
            min_pitch,
            max_pitch,
            min_velocity,
            include_drums,
            ..Default::default()
        },
    )
    .map_err(err)?;
    Ok(Playback { inner })
}

/// Map props (`.swmap`) as a JSON array, ordered by id.
#[wasm_bindgen]
pub fn prop_catalog() -> String {
    let mut props: Vec<_> = MapCatalog::shared().props.values().collect();
    props.sort_by_key(|p| p.id);
    let rows: Vec<serde_json::Value> = props
        .into_iter()
        .map(|p| {
            let mut flags = Vec::new();
            if p.allow_free_scale { flags.push("free scale".to_string()); }
            if p.has_floors { flags.push(format!("floors ({})", p.default_floors)); }
            if p.glowable { flags.push("glow".into()); }
            if p.transparent { flags.push("transparent".into()); }
            if !p.colorable { flags.push("no color".into()); }
            if p.hidden_in_game { flags.push("invisible".into()); }
            if p.destroyable { flags.push("destroyable".into()); }
            if p.hidden { flags.push("hidden".into()); }
            let v = |v: &sw_formats::primitives::Vec3| format!("({}, {}, {})", v.x, v.y, v.z);
            serde_json::json!({
                "id": p.id,
                "name": p.name,
                "category": match p.category {
                    MapPropCategory::Trees => "Trees",
                    MapPropCategory::Rocks => "Rocks",
                    MapPropCategory::Buildings => "Buildings",
                    MapPropCategory::Roads => "Roads",
                    MapPropCategory::Bridges => "Bridges",
                    MapPropCategory::Props => "Props",
                    MapPropCategory::Shapes => "Shapes",
                    MapPropCategory::Background => "Background",
                },
                "flags": flags.join(", "),
                "bounds_center": v(&p.bounds_center),
                "bounds_size": v(&p.bounds_size),
            })
        })
        .collect();
    serde_json::Value::Array(rows).to_string()
}

/// Terrain layers (`.swmap`) as a JSON array, ordered by id.
#[wasm_bindgen]
pub fn layer_catalog() -> String {
    let cat = MapCatalog::shared();
    let mut layers: Vec<_> = cat.layers.values().collect();
    layers.sort_by_key(|l| l.id);
    let rows: Vec<serde_json::Value> = layers
        .into_iter()
        .map(|l| {
            serde_json::json!({
                "id": l.id,
                "name": l.name,
                "grass": l.grass,
                "hidden": l.hidden,
                "new_map": cat.new_map_layers.contains(&l.id),
            })
        })
        .collect();
    serde_json::Value::Array(rows).to_string()
}
