"""Methane source classifier — Streamlit frontend.

Upload or pick a satellite tile, send it to the FastAPI backend (or the built-in
demo classifier when no backend is configured), and show which methane-emitting
facility category the image contains (or "Negative"), with per-category scores.

Categories follow the METER-ML benchmark (Zhu et al., 2022) — see CLAUDE.md.

Styling follows the placeholder theme (see DESIGN.md): dark flat console,
JetBrains Mono for all interface labels, a single electric-lime accent.
"""
from __future__ import annotations

import io
import time

import pandas as pd
import streamlit as st
from PIL import Image

from lib import api_client, config, mock
from lib.samples import SAMPLES, make_tile
from lib.schema import CATEGORY_LABELS

st.set_page_config(
    page_title="Methane Source Classifier",
    page_icon="◆",
    layout="wide",
    initial_sidebar_state="expanded",
)

# --------------------------------------------------------------------------- #
# Placeholder theme (see DESIGN.md) — flat, shadowless, mono labels, lime accent.
# --------------------------------------------------------------------------- #
st.markdown(
    """
    <style>
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700&display=swap');

      :root {
        --loam:#13140e; --bone:#f4f3e8; --iron:#404040;
        --ash:#84837b; --lime:#ebfc72; --olive:#bacd31;
        --mono:'JetBrains Mono', ui-monospace, monospace;
      }
      .block-container {padding-top:2.4rem; max-width:1200px;}

      /* Headline: humanist, tight tracking, no weight-of-stroke */
      h1 {font-weight:400 !important; letter-spacing:-0.03em; font-size:2.8rem; line-height:0.95;}
      h2, h3 {font-weight:400 !important; letter-spacing:-0.02em;}
      .subtitle {font-family:var(--mono); color:var(--ash); font-size:0.8rem;
                 text-transform:uppercase; letter-spacing:0.08em; margin-top:-0.4rem;}

      /* Mono voice for every interface annotation */
      .stCaption, [data-testid="stMetricLabel"], [data-testid="stWidgetLabel"] label,
      .stButton button, [data-testid="stMetricValue"], code {font-family:var(--mono) !important;}
      [data-testid="stMetricLabel"] {text-transform:uppercase; letter-spacing:0.06em;
                 font-size:0.7rem !important; color:var(--ash) !important;}

      /* Metrics as instrument readouts: hairline, flat, zero radius */
      [data-testid="stMetric"] {background:transparent; border:1px solid var(--iron);
                 border-radius:0; padding:14px 16px;}
      [data-testid="stMetricValue"] {font-size:1.4rem !important;}

      /* Buttons: flat, 3.6px radius, mono. Primary = lime survey marker. */
      .stButton button {border-radius:3.6px; box-shadow:none !important;
                 text-transform:uppercase; letter-spacing:0.06em; font-size:0.8rem;
                 border:1px solid var(--iron);}
      .stButton button[kind="primary"] {background:var(--lime); color:var(--loam);
                 border:1px solid var(--lime); font-weight:700;}

      /* No elevation anywhere; sharp corners on inputs */
      [data-testid="stImage"] img {border-radius:0;}
      .stTabs [data-baseweb="tab"] {font-family:var(--mono); text-transform:uppercase;
                 letter-spacing:0.05em; font-size:0.78rem;}

      /* Data tag / status pill */
      .tag {display:inline-block; font-family:var(--mono); font-size:0.72rem;
            padding:4px 8px; border-radius:3.6px; text-transform:uppercase;
            letter-spacing:0.06em;}
      .tag-live {background:var(--lime); color:var(--loam);}
      .tag-demo {background:transparent; color:var(--lime); border:1px solid var(--lime);}
    </style>
    """,
    unsafe_allow_html=True,
)


# --------------------------------------------------------------------------- #
# State
# --------------------------------------------------------------------------- #
def _init_state() -> None:
    st.session_state.setdefault("image", None)
    st.session_state.setdefault("image_name", None)
    st.session_state.setdefault("prediction", None)
    st.session_state.setdefault("source", None)


_init_state()


def set_image(img: Image.Image, name: str) -> None:
    st.session_state.image = img.convert("RGB")
    st.session_state.image_name = name
    st.session_state.prediction = None  # invalidate previous result


# --------------------------------------------------------------------------- #
# Sidebar
# --------------------------------------------------------------------------- #
with st.sidebar:
    st.markdown("### Controls")

    backend_ok = api_client.health()
    if api_client.is_configured() and backend_ok:
        st.markdown('<span class="tag tag-live">● backend live</span>', unsafe_allow_html=True)
        st.caption(config.API_URL)
    elif api_client.is_configured():
        st.markdown('<span class="tag tag-demo">● demo · backend down</span>', unsafe_allow_html=True)
        st.caption(f"{config.API_URL} did not respond")
    else:
        st.markdown('<span class="tag tag-demo">● demo mode</span>', unsafe_allow_html=True)
        st.caption("Set METHANE_API_URL for the real model.")

    st.divider()
    threshold = st.slider(
        "Classification threshold", 0.05, 0.95, 0.30, 0.05,
        help="Minimum score for the top category. Below it, the image is "
             "classified as Negative (no methane source).",
    )

    st.divider()
    st.caption("Le Wagon · Data Science final project")


# --------------------------------------------------------------------------- #
# Header
# --------------------------------------------------------------------------- #
st.title("Methane Source Classifier")
st.markdown(
    '<p class="subtitle">Identify methane-emitting facilities in satellite imagery</p>',
    unsafe_allow_html=True,
)

# --------------------------------------------------------------------------- #
# Input
# --------------------------------------------------------------------------- #
tab_upload, tab_samples = st.tabs(["Upload image", "Sample tiles"])

with tab_upload:
    uploaded = st.file_uploader(
        "Satellite image", type=["png", "jpg", "jpeg", "tif", "tiff"],
        label_visibility="collapsed",
    )
    if uploaded is not None:
        img = Image.open(uploaded)
        if st.session_state.image_name != uploaded.name or st.session_state.image is None:
            set_image(img, uploaded.name)

with tab_samples:
    cols = st.columns(len(SAMPLES))
    for col, (name, seed) in zip(cols, SAMPLES.items()):
        with col:
            tile = make_tile(seed)
            st.image(tile, width="stretch")
            if st.button(name, width="stretch", key=f"sample_{seed}"):
                set_image(tile, name)


# --------------------------------------------------------------------------- #
# Analyse
# --------------------------------------------------------------------------- #
def run_detection(image: Image.Image, name: str) -> None:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    image_bytes = buf.getvalue()

    if api_client.is_configured() and backend_ok:
        try:
            pred = api_client.predict(image_bytes, name, threshold)
            st.session_state.source = "backend"
        except api_client.BackendError as exc:
            st.warning(f"Backend error, using demo classifier: {exc}")
            pred = mock.predict(image, threshold)
            st.session_state.source = "demo"
    else:
        pred = mock.predict(image, threshold)
        st.session_state.source = "demo"

    st.session_state.prediction = pred


if st.session_state.image is not None:
    st.divider()
    left, right = st.columns([3, 1])
    with left:
        st.markdown(f"**Selected** · `{st.session_state.image_name}`")
    with right:
        if st.button("◆ Classify source", type="primary", width="stretch"):
            with st.spinner("Analysing imagery…"):
                t0 = time.time()
                run_detection(st.session_state.image, st.session_state.image_name)
                st.session_state.elapsed = time.time() - t0

# --------------------------------------------------------------------------- #
# Results
# --------------------------------------------------------------------------- #
pred = st.session_state.prediction
if pred is not None and st.session_state.image is not None:
    src_label = "real model" if st.session_state.source == "backend" else "demo classifier"

    m1, m2, m3 = st.columns(3)
    if pred.is_negative:
        m1.metric("Prediction", "Negative")
    else:
        m1.metric(
            "Prediction",
            pred.prediction,
            help=CATEGORY_LABELS.get(pred.prediction),
        )
    m2.metric("Score", f"{pred.score:.0%}")
    m3.metric("Source", src_label)

    img_col, out_col = st.columns(2)
    with img_col:
        st.caption("input")
        st.image(st.session_state.image, width="stretch")
    with out_col:
        st.caption(f"category scores · {src_label}")
        if pred.scores:
            df = pd.DataFrame(
                [
                    {"Category": CATEGORY_LABELS.get(c, c), "Score": s * 100}
                    for c, s in sorted(
                        pred.scores.items(), key=lambda kv: kv[1], reverse=True
                    )
                ]
            )
            st.dataframe(
                df,
                width="stretch",
                hide_index=True,
                column_config={
                    "Score": st.column_config.ProgressColumn(
                        "Score", min_value=0.0, max_value=100.0, format="%.0f%%"
                    )
                },
            )
        else:
            st.info("Backend returned no per-category scores.")

    if pred.is_negative:
        st.info(
            "No source scored above the current threshold — classified Negative. "
            "Lower the threshold in the sidebar to be less strict."
        )

    with st.expander("Prediction metadata"):
        st.json(
            {
                "prediction": pred.prediction,
                "score": round(pred.score, 4),
                "source": st.session_state.source,
                "elapsed_s": round(st.session_state.get("elapsed", 0), 3),
                "meta": pred.meta,
            }
        )
elif st.session_state.image is None:
    st.info("Upload an image or pick a sample tile to begin.")
