import { updateSliderMax, getTimes } from "./trim.js";

const videoTrimContainer = document.getElementById('video-trim-container');
const videoUploadContainer = document.getElementById('video-select-container');
videoUploadContainer.style.display = 'flex';

// Not used as of now, dependency doesn't work
const youtubeSubmitButton = document.getElementById('youtube-link-submit');

const youtubeFileInput = document.getElementById('youtube-file-input');

// The video that shows where trimming will occur
const videoPlayer = document.getElementById('trimming-video');

// Status reading
const statusContainer = document.getElementById('status-container');
statusContainer.style.display = 'none';

// When the video is loaded (duration changes) update the maximum time for the sliders
videoPlayer.ondurationchange = updateSliderMax;

youtubeFileInput.addEventListener('change', function (e) {
    videoUploadContainer.style.display = 'none';
    videoTrimContainer.style.display = 'flex';

    // The file
    let videoFile = e.target.files[0];

    // Set the 'fake' input's file to the video
    document.getElementById('fake-video-upload').files = e.target.files;

    // Now set the video's source to the uploaded file
    videoPlayer.src = URL.createObjectURL(videoFile);
});

// The submit button, uploads the video and the trimming data
document.getElementById('trim-video-button').addEventListener('click', function () {
    let data = {
        "start": getTimes().startTime,
        "end": getTimes().endTime,
        "trim": true
    };

    // Post to trim
    fetch("/trim", {
        method: "post",
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(res => {
        videoTrimContainer.style.display = 'none';
        statusContainer.style.display = 'flex';
    });
});

// The submit button, uploads the video and the trimming data
document.getElementById('skip-trim-video-button').addEventListener('click', function () {
    let data = {
        "start": getTimes().startTime,
        "end": getTimes().endTime,
        "trim": false
    };

    // Post to trim
    fetch("/trim", {
        method: "post",
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(res => {
        videoTrimContainer.style.display = 'none';
        statusContainer.style.display = 'flex';
    });
});