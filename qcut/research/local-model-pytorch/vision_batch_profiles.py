"""Audited identities for the bounded phase-four vision conversion batch."""

FORMAT = "qcut-private-vision-batch-pytorch-v1"
EXECUTION_PROFILE = "cpu-fp32-ohwi-hwc-v1"
RUNTIME_SHA256 = "1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0"
PROFILES = {
    "bandou": {
        "source_filename": "newbandou_v1.0_size0_md5bb66e26e632c60d1dff15a1ceec50d4f.model",
        "source_sha256": "11f3a90604b6ccdc95f9dbd150884e05e0b9eafed098ad62f1112d949b8916cf",
        "bm_sha256": "d83a7198afee5f9466720d3c64687fdf285cc58c5fa11d9a2d86face3400b36f",
        "graph_sha256": "dd1d38695aa8c6d2f3945915e1f1cefe046e772e1ecde65ce501f31736de0393",
        "state_sha256": "6f6e13fb67861fab74c8f0298e55335b50288c65ba3001a6ff76e2e1cffbb6cb",
        "native_verified": False,
        "input_shape": [1, 3, 512, 512], "layer_count": 65,
        "outputs": {"/tanh/Tanh": [1, 4, 512, 512]},
    },
    "normal": {
        "source_filename": "nh_normal_estimation_offline_v1.1_size0_md50ad5c57b45a56ba3e38f265e90dde8ef.model",
        "source_sha256": "a41666f940777f976422be081bb0ce0bf1687102369fb4ed6e6ea51137fdeea6",
        "bm_sha256": "a2ac0b09c409390e5aadaa44cefc214c946b1fabf59b24e4140cc076904a4999",
        "graph_sha256": "00fdfabbed1ebde1fb7721478d09f01ca094d6998da33717cd1626da8466acee",
        "state_sha256": "d9cc9c1c02d54b8aba0b66e1042c4798b71ca0eccca1e5affc1449369473329a",
        "native_verified": True,
        "input_shape": [1, 3, 400, 224], "layer_count": 66,
        "outputs": {"up3.2": [1, 3, 400, 224]},
    },
    "clip2m": {
        "source_filename": "nodehub_clip_d128_2m_fp32_v1.0_size0_md5570f84d1b8608c4cd1d1b9d665d91be7.model",
        "source_sha256": "e369b1d6f409e0a406e7b772ebebd94d30432d15899d2ebbe6d16fe0dbc025f2",
        "bm_sha256": "e369b1d6f409e0a406e7b772ebebd94d30432d15899d2ebbe6d16fe0dbc025f2",
        "graph_sha256": "ed09571a91729d1a63d92e147a1a12852bd04f817e28afc85bb0a82c09507d5e",
        "state_sha256": "4f4fe155781ae47e21aacfbbbdea01f14f194c0994887a6543b477bbf8193e40",
        "native_verified": True,
        "input_shape": [1, 3, 224, 224], "layer_count": 139,
        "outputs": {"v_projector": [1, 128, 1, 1]},
    },
    "clip30m": {
        "source_filename": "nodehub_clip_d128_30M_pc_v1.0_size0_md56ee31b159128972e51d294713d7d66e7.model",
        "source_sha256": "6330e9ac9f76bdee3eafe83921a8515bb21018c7247ae5e8ff317751c7dbb523",
        "bm_sha256": "6330e9ac9f76bdee3eafe83921a8515bb21018c7247ae5e8ff317751c7dbb523",
        "graph_sha256": "863ee348430c7a0cf0bf6515e68f9bad1f1a5d5b12cd8c92cc648264871488fd",
        "state_sha256": "cbae67275a581b195aa53f972d2369f1ed4a198f969f885437c14798578ff783",
        "native_verified": True,
        "input_shape": [1, 3, 224, 224], "layer_count": 50,
        "outputs": {"v_projector": [1, 128, 1, 1]},
    },
}
