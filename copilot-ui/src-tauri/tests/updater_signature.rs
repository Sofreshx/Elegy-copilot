use std::{fs, io::Read, path::PathBuf};

use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use serde_json::Value;

#[test]
#[ignore = "requires a freshly built signed Windows updater bundle"]
fn signed_updater_matches_the_committed_public_key() {
    let tauri_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = tauri_root.parent().expect("copilot-ui root");
    let config: Value = serde_json::from_slice(
        &fs::read(tauri_root.join("tauri.conf.json")).expect("Tauri config"),
    )
    .expect("Tauri config JSON");
    let encoded_public_key = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .expect("configured updater public key");
    let public_key_text = String::from_utf8(
        base64::engine::general_purpose::STANDARD
            .decode(encoded_public_key)
            .expect("base64 updater public key"),
    )
    .expect("UTF-8 updater public key");
    let public_key = PublicKey::decode(&public_key_text).expect("minisign updater public key");

    let release_root = workspace_root.join("release/tauri/windows");
    let manifest: Value = serde_json::from_slice(
        &fs::read(release_root.join("release-manifest.json")).expect("release manifest"),
    )
    .expect("release manifest JSON");
    let artifact = manifest["artifact"]["relativePath"]
        .as_str()
        .expect("artifact relativePath");
    let signature_relative = manifest["updateLane"]["updaterSignatureRelativePath"]
        .as_str()
        .expect("signature relativePath");
    let signature = Signature::decode(
        &fs::read_to_string(release_root.join(signature_relative)).expect("updater signature"),
    )
    .expect("minisign updater signature");

    let mut verifier = public_key
        .verify_stream(&signature)
        .expect("prehashed updater signature");
    let mut installer = fs::File::open(release_root.join(artifact)).expect("signed installer");
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = installer.read(&mut buffer).expect("read signed installer");
        if count == 0 {
            break;
        }
        verifier.update(&buffer[..count]);
    }
    verifier
        .finalize()
        .expect("configured public key must verify the updater signature");
}
