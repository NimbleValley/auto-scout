import os
import sys
import json
import os
from roboflow import Roboflow

dir_path = os.path.abspath(os.path.join(os.path.dirname( __file__ ), '..', 'temp/trimmed.mp4'))

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

model.confidence = 50
model.iou_threshold = 25

job_id, signed_url, expire_time = model.predict_video(
    dir_path,
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