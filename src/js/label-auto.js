import { updateSliderMax, getTimes } from "./trim.js";
import { socket } from "./status.js";

socket.on("label-robot", handleRobotLabelRequest);

const videoTrimContainer = document.getElementById('video-trim-container');
const videoUploadContainer = document.getElementById('video-select-container');
videoUploadContainer.style.display = 'flex';

// Not used as of now, dependency doesn't work
const youtubeSubmitButton = document.getElementById('youtube-link-submit');
const youtubeFileInput = document.getElementById('youtube-file-input');

// The video that shows where trimming will occur
const videoPlayer = document.getElementById('trimming-video');

const eventSelect = document.getElementById('event-select');

const generateFilesButton = document.getElementById('generate-files-button');
generateFilesButton.addEventListener('click', function () {
    let allianceTeams = {
        'blue': [],
        'red': []
    }
    let teamNumberInputs = document.getElementsByClassName('team-number-input');
    let tempArray = [];
    for (let i = 0; i < teamNumberInputs.length; i++) {
        tempArray.push(teamNumberInputs[i].value != '' ? teamNumberInputs[i].value : -1);
    }
    allianceTeams.blue = tempArray.splice(0, 3);
    allianceTeams.red = tempArray.splice(0, 3);

    console.log(allianceTeams);

    socket.emit('generate-files', JSON.stringify(allianceTeams));
});

// Status reading
const statusContainer = document.getElementById('status-container');
statusContainer.style.display = 'none';

const userLabelColors = ['cyan', 'lime', 'purple', 'red', 'orange', 'yellow'];
const robotUserLabelContainer = document.getElementById('robot-generation-container');
robotUserLabelContainer.style.display = 'none';

// When the video is loaded (duration changes) update the maximum time for the sliders
videoPlayer.ondurationchange = updateSliderMax;

const labelAutoButton = document.getElementById('label-auto-button');
labelAutoButton.addEventListener('click', function (e) {
    e.preventDefault();
    videoUploadContainer.style.display = 'none';
    videoTrimContainer.style.display = 'flex';

    // The file
    let videoFile = youtubeFileInput.files[0];

    // Set the 'fake' input's file to the video
    document.getElementById('fake-video-upload').files = youtubeFileInput.files;

    // Now set the video's source to the uploaded file
    videoPlayer.src = URL.createObjectURL(videoFile);
});

// The submit button, uploads the video and the trimming data
document.getElementById('trim-video-button').addEventListener('click', function () {
    let data = {
        "start": getTimes().startTime,
        "end": getTimes().endTime,
        "trim": true,
        "distortion": (eventSelect.value)
    };

    console.log(JSON.stringify(eventSelect.value));

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
        "trim": false,
        "distortion": (eventSelect.value)
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

async function loadFields() {
    eventSelect.innerHTML = '';

    let fieldData = await (await fetch('./stored/fields.json')).json();

    if (fieldData == null) {
        fieldData = [];
    }

    for (let i = 0; i < fieldData.length; i++) {
        let tempOption = document.createElement('option');
        tempOption.innerText = fieldData[i].name;
        tempOption.value = JSON.stringify(fieldData[i].data);
        eventSelect.appendChild(tempOption);
    }
}

async function handleRobotLabelRequest(data) {
    robotUserLabelContainer.style.display = 'flex';

    let teamNumberInputs = document.getElementsByClassName('team-number-input');

    let parsedBlue = JSON.parse(data.blue);
    let parsedRed = JSON.parse(data.red);

    const blob = new Blob([data.image]);
    const imgBlobUrl = window.URL.createObjectURL(blob);

    const labelingCanvas = document.getElementById('user-labeling-canvas');
    var ctx = labelingCanvas.getContext('2d');
    let canvasImage;

    await loadImage(imgBlobUrl).then(image =>
        canvasImage = image
    );

    labelingCanvas.width = canvasImage.width;
    labelingCanvas.height = canvasImage.height;
    ctx.drawImage(canvasImage, 0, 0);

    ctx.lineWidth = 15;
    for (let i = 0; i < parsedBlue.length; i++) {
        console.log(userLabelColors[i]);
        ctx.strokeStyle = userLabelColors[i];
        teamNumberInputs[i].style.backgroundColor = userLabelColors[i];
        ctx.strokeRect(parsedBlue[i].x - (parsedBlue[i].width / 2), parsedBlue[i].y - (parsedBlue[i].height / 2), parsedBlue[i].width, parsedBlue[i].height);
    }

    for (let i = 0; i < parsedRed.length; i++) {
        ctx.strokeStyle = userLabelColors[i + 3];
        teamNumberInputs[i + 3].style.backgroundColor = userLabelColors[i + 3];
        ctx.strokeRect(parsedRed[i].x - (parsedRed[i].width / 2), parsedRed[i].y - (parsedRed[i].height / 2), parsedRed[i].width, parsedRed[i].height);
    }
}

const loadImage = src =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });

loadFields();