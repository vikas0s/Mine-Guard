
import joblib
import pandas as pd


# ------------------------------------------------------------
# Load trained artifacts
# ------------------------------------------------------------

MODEL_PATH = "sih26025_final_model.pkl"
SCALER_PATH = "sih26025_scaler.pkl"
FEATURES_PATH = "sih26025_features.pkl"
CONFIG_PATH = "sih26025_config.pkl"


model = joblib.load(MODEL_PATH)
scaler = joblib.load(SCALER_PATH)
features = joblib.load(FEATURES_PATH)
config = joblib.load(CONFIG_PATH)


# ------------------------------------------------------------
# Risk labels
# ------------------------------------------------------------

RISK_LABELS = {
    0: "NORMAL",
    1: "WARNING",
    2: "HIGH_RISK",
    3: "CRITICAL"
}


# ------------------------------------------------------------
# Prediction function
# ------------------------------------------------------------

def predict_mine_risk(feature_data):

    # Check required features
    missing_features = [
        f for f in features
        if f not in feature_data
    ]

    if missing_features:
        raise ValueError(
            f"Missing features: {missing_features}"
        )

    # Create DataFrame with correct feature names
    X = pd.DataFrame(
        [[feature_data[f] for f in features]],
        columns=features
    )

    # Scale
    X_scaled = scaler.transform(X)

    # Base prediction
    base_prediction = int(
        model.predict(X_scaled)[0]
    )

    # Probabilities
    probabilities = model.predict_proba(
        X_scaled
    )[0]

    probability_dict = {
        RISK_LABELS[int(cls)]: round(
            float(prob), 4
        )
        for cls, prob in zip(
            model.classes_,
            probabilities
        )
    }

    # --------------------------------------------------------
    # Safety decision layer
    # --------------------------------------------------------

    critical_index = list(
        model.classes_
    ).index(3)

    critical_probability = float(
        probabilities[critical_index]
    )

    critical_threshold = float(
        config["critical_threshold"]
    )

    final_prediction = base_prediction

    if critical_probability >= critical_threshold:
        final_prediction = 3

    # --------------------------------------------------------
    # Final JSON-compatible output
    # --------------------------------------------------------

    return {
        "risk_level": RISK_LABELS[final_prediction],
        "risk_class": final_prediction,
        "critical_probability": round(
            critical_probability, 4
        ),
        "critical_threshold": critical_threshold,
        "probabilities": probability_dict
    }
