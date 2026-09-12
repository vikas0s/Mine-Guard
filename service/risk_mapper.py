"""
risk_mapper.py
Single source of truth for mapping ML 4-class risk levels to 3-tier UI risk system
and applying raw sensor safety overrides.
"""

def map_ml_to_ui_risk(model_risk_level: str, critical_probability: float = 0.0) -> dict:
    """
    Lookup table mapping:
    - NORMAL -> LOW, score 0, buzzer 'silent'
    - WARNING -> MEDIUM, score 2-4 (critical_probability * 5 rounded, clamped [2, 4]), buzzer 'beep_once'
    - HIGH_RISK | CRITICAL -> HIGH, score 5, buzzer 'beep_continuous'
    """
    model_risk_level = (model_risk_level or "NORMAL").upper()

    if model_risk_level == "NORMAL":
        return {
            "riskLevel": "LOW",
            "riskScore": 0,
            "buzzerState": "silent"
        }
    elif model_risk_level == "WARNING":
        # use critical_probability * 5, rounded, clamped to 2..4
        calc_score = round(critical_probability * 5)
        score = max(2, min(4, calc_score if calc_score >= 2 else 2))
        return {
            "riskLevel": "MEDIUM",
            "riskScore": score,
            "buzzerState": "beep_once"
        }
    elif model_risk_level in ("HIGH_RISK", "CRITICAL"):
        return {
            "riskLevel": "HIGH",
            "riskScore": 5,
            "buzzerState": "beep_continuous"
        }
    else:
        # Fallback
        return {
            "riskLevel": "LOW",
            "riskScore": 0,
            "buzzerState": "silent"
        }


def apply_sensor_safety_override(current_risk: dict, tilt: float, displacement: float) -> dict:
    """
    Raw sensor safety net overrides independent of the model:
    - tilt <= 10 deg AND displacement <= 2 cm -> LOW
    - tilt > 10 deg OR displacement > 2 cm -> at least MEDIUM
    - both tilt > 10 deg AND displacement > 2 cm severely exceeded -> HIGH
      (severely exceeded: tilt > 25 deg OR displacement > 5 cm, or both exceeded tilt > 15 & disp > 3)
    """
    tilt_val = abs(float(tilt or 0.0))
    disp_val = abs(float(displacement or 0.0))

    severely_exceeded = (
        (tilt_val > 25.0 or disp_val > 5.0) or
        (tilt_val > 15.0 and disp_val > 3.0) or
        (tilt_val > 10.0 and disp_val > 2.0 and (tilt_val > 20.0 or disp_val > 4.0))
    )

    override_level = None
    override_score = None
    override_buzzer = None

    if severely_exceeded:
        override_level = "HIGH"
        override_score = 5
        override_buzzer = "beep_continuous"
    elif tilt_val > 10.0 or disp_val > 2.0:
        # Minimum MEDIUM
        if current_risk["riskLevel"] != "HIGH":
            override_level = "MEDIUM"
            override_score = max(current_risk.get("riskScore", 2), 3)
            override_buzzer = "beep_once"

    if override_level:
        return {
            "riskLevel": override_level,
            "riskScore": override_score,
            "buzzerState": override_buzzer,
            "safetyOverrideApplied": True
        }

    return {
        **current_risk,
        "safetyOverrideApplied": False
    }


def compute_final_risk(model_risk_level: str, critical_probability: float, tilt: float, displacement: float) -> dict:
    """
    Combined computation: ML prediction mapped + safety override evaluated.
    """
    base = map_ml_to_ui_risk(model_risk_level, critical_probability)
    final = apply_sensor_safety_override(base, tilt, displacement)
    return final
