from roboflow import Roboflow

rf = Roboflow(api_key="1234")
project = rf.workspace().project("bumper-detection-b8q8f")
model = project.version("2").model

job_id, signed_url, expire_time = model.predict_video(
    "C:/Users/Owner/Desktop/BumperVideos/src/3197.mp4",
    fps=5,
    prediction_type="batch-video",
)

results = model.poll_until_video_results(job_id)

print(results)