import os
import sys
import json
from roboflow import Roboflow

# Disable
def blockPrint():
    sys.stdout = open(os.devnull, 'w')

# Restore
def enablePrint():
    sys.stdout = sys.__stdout__
    
blockPrint()

rf = Roboflow(api_key="1234")
project = rf.workspace().project("bumper-detection-b8q8f")
model = project.version("3").model

model.confidence = 25

job_id, signed_url, expire_time = model.predict_video(
    "C:/Users/Owner/Desktop/Robot Locating/src/temp/trimmed.mp4",
    fps=15,
    prediction_type="batch-video",
)

results = model.poll_until_video_results(job_id)

enablePrint()

parsed = json.dumps(results, indent=4, sort_keys=True)

f = open("C:/Users/Owner/Desktop/Robot Locating/src/temp/robotoutput.json", "w")
f.write(parsed)
f.close()

print("Wrote file")

sys.stdout.flush()