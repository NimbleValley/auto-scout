import { getDistance, pointInPolygon, subdivideQuad, Point } from './helpers.js'
import { videoScale } from './crop-video.js';
import { Server } from 'socket.io';
import { createServer } from 'http';
import express from 'express';
import spawn from 'child_process';
import GIFEncoder from 'gifencoder';
import fileUpload from 'express-fileupload';
import bodyParser from 'body-parser';
import ffmpeg from 'fluent-ffmpeg';
import extractFrames from 'ffmpeg-extract-frames';

import nodecanvas from 'canvas';
import axios from 'axios';

import fs from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
const __dirname = path.resolve();

var outputSettings = {
    'start': 0,
    'end': 0,
    'trim': true,
    'distortion': []
}

const OUTPUT_FRAMERATE_FPS = 15;
const SMOOTHING = 1;
const API_KEY = '1234';

var robotDetectionData;
var originalSections;

const PORT = 8080;
const app = express();
app.use(fileUpload());
app.use(bodyParser.json({
    limit: '500mb'
}));
app.use(bodyParser.urlencoded({
    limit: '500mb',
    parameterLimit: 100000,
    extended: true
}));
app.use(express.static('./src'));
app.use(express.json({ limit: '1000mb', extended: true }));

const server = createServer(app);
server.listen(PORT, function () {
    console.log(`Server running on port ${PORT}`);
});
const socketio = new Server(server);
// None for now
socketio.on('connection', (socket) => {
    socket.on('send-distortion', async function (sections) {
        await writeJSON(__dirname + '/src/stored/fields.json', JSON.stringify(sections));
        socket.emit('done-writing-distortion');
    });
    socket.on('select-distortion', async function (sections) {
        originalSections = sections;
    });
    socket.on('generate-files', async function (teams) {
        let parsedTeams = JSON.parse(teams);
        console.log(parsedTeams.blue);
        console.log(parsedTeams.red);
        labelAlliance('blue', robotDetectionData, parsedTeams.blue);
        labelAlliance('red', robotDetectionData, parsedTeams.red);
    });
});

// Start and end times for trim
app.post('/trim', function (req, res) {
    outputSettings = {
        'start': req.body.start,
        'end': req.body.end,
        'trim': req.body.trim,
        'distortion': req.body.distortion
    }
    originalSections = JSON.parse(outputSettings.distortion);
    console.log(outputSettings);

    res.end();
});

// Upload the untrimmed video
app.post('/upload', function (req, res) {
    let sampleFile;
    let uploadPath;
    console.log('Uploaded');

    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).send('No files were uploaded.');
    }

    // The name of the input field (i.e. 'sampleFile') is used to retrieve the uploaded file
    sampleFile = req.files.videoFile;
    uploadPath = __dirname + '/src/temp/untrimmed.mp4';

    // Use the mv() method to place the file somewhere on your server
    sampleFile.mv(uploadPath, async function (err) {
        if (err)
            return res.status(500).send(err);

        socketio.emit('status-update', 'Video recieved');

        console.log('Uploaded');

        if (JSON.parse(outputSettings.trim)) {
            trimVideo();
        } else {
            fs.copyFile(__dirname + '/src/temp/untrimmed.mp4', __dirname + '/src/temp/trimmed.mp4', (err) => {
                if (err) throw err;
                console.log('Copied untrimmed video sucessfully');
                runDetections();
            });
        }

        res.status(204).send();
    });

});

// Upload the field video
app.post('/upload-segmentation-video', function (req, res) {
    let sampleFile;
    let uploadPath;
    console.log('Uploaded');

    console.log(req.body.frame);

    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).send('No files were uploaded.');
    }

    // The name of the input field (i.e. 'sampleFile') is used to retrieve the uploaded file
    sampleFile = req.files.videoFile;
    uploadPath = __dirname + '/src/temp/segment.mp4';

    sampleFile.mv(uploadPath, async function (err) {
        if (err)
            return res.status(500).send(err);

        getFrame(parseFloat(req.body.frame) * 30, __dirname + '/src/temp/fieldframe.jpg').then(() => {
            segmentField(2024);
        });

        res.status(204).send();
    });
});

// Trim the video using ffmpeg
function trimVideo() {
    return new Promise((resolve, reject) => {
        ffmpeg({ source: __dirname + '/src/temp/untrimmed.mp4' })
            .setStartTime(outputSettings.start)
            .duration(outputSettings.end - outputSettings.start)
            .on('start', function (e) {
                socketio.emit('status-update', 'Video trimming starting');
                console.log('Processing started')
            })
            .on('error', function (e) {
                console.log('Processing error: ' + e);
                socketio.emit('status-update', e);
                reject();
            })
            .on('end', function (e) {
                console.log('Processing complete');
                socketio.emit('status-update', 'Video sucessfully trimmed');
                runDetections();
                resolve();
            })
            .saveToFile(__dirname + '/src/temp/trimmed.mp4');
    });
}

function cropVideo(width, height) {
    videoScale(__dirname + '/src/temp/trimmed.mp4', width, height);
}

// Video has been trimmed, now run all detections
function runDetections() {
    detectRobots();
}

// Promise that saves the specified frame to use for field segmentation
function getFrame(frame, destination) {
    let ms = parseInt(frame / (OUTPUT_FRAMERATE_FPS * 2)) * 1000;
    console.log('Getting frame');

    return new Promise(async (resolve, reject) => {
        try {
            await extractFrames({
                input: __dirname + '/src/temp/segment.mp4',
                output: destination,
                offsets: [
                    ms
                ]
            });
            resolve();
        } catch (e) {
            console.log(e);
            console.log(e.msg);
            reject();
        }
    });
}

// Now segment the field
function segmentField(year) {
    const fieldFrame = fs.readFileSync(__dirname + '/src/temp/fieldframe.jpg', {
        encoding: 'base64'
    });

    switch (year) {
        case 2024:

            axios({
                method: 'POST',
                url: 'https://detect.roboflow.com/frc-field/1',
                params: {
                    api_key: API_KEY
                },
                data: fieldFrame,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            })
                .then(function (response) {
                    console.log(response.data);
                    socketio.emit('send-field-points-2024', response.data);
                })
                .catch(function (error) {
                    console.log(error.message);
                    socketio.emit('image-error', error.message);
                });
            break;
        default:
            console.error('Invalid year');
            break;
    }
}

// Sends detection job by running python script
function detectRobots() {
    socketio.emit('status-update', 'Sending robot detection job');

    const pythonProcess = spawn.spawn('python', [__dirname + '/src/python/detect-video.py']);

    // Once python script is done it will run this
    pythonProcess.stdout.on('data', (data) => {
        socketio.emit('status-update', 'Robot detection job complete');

        // Read json file saved from python script
        let jsonOutput = JSON.parse(fs.readFileSync(__dirname + '/src/temp/robotoutput.json').toString());
        socketio.emit('status-update', 'Json parse complete');

        // Then just render frames
        robotDetectionData = jsonOutput;

        requestUserLabeling();

        //labelAlliance('blue', jsonOutput);
    });
}

// Renders the final gif
async function renderFrames(data) {
    var img = await nodecanvas.loadImage(__dirname + '/img/field24.png');

    // Delete old frames
    try {
        fsExtra.emptyDirSync(__dirname + '/src/temp/output');
        socketio.emit('status-update', 'Emptying folder');
    } catch (e) {
        console.error('Error emptying output folder', e);
    }

    socketio.emit('status-update', 'Starting gif');

    // Dimensions of frc field: 54' by 26'
    // For testing make it really big
    const canvas = nodecanvas.createCanvas(54 * 40, 26 * 40);
    const ctx = canvas.getContext('2d');

    const encoder = new GIFEncoder(canvas.width, canvas.height);
    encoder.createReadStream().pipe(fs.createWriteStream(__dirname + '/src/temp/output/visualization.gif'));
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(1000 / OUTPUT_FRAMERATE_FPS / SMOOTHING);
    encoder.setQuality(50);

    for (let i = 0; i < data.length; i++) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'grey';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        for (let p = 0; p < data[i].predictions.length; p++) {
            let targetPoint = new Point(data[i].predictions[p].x + (data[i].predictions[p].width / 2), data[i].predictions[p].y + (data[i].predictions[p].height / 2));
            let targetSection;

            for (let s = 0; s < originalSections.length; s++) {
                let tempScreenPoints = [originalSections[s].p1.screenPoint, originalSections[s].p2.screenPoint, originalSections[s].p4.screenPoint, originalSections[s].p3.screenPoint];

                if (pointInPolygon(targetPoint, tempScreenPoints)) {
                    targetSection = originalSections[s];
                    break;
                }
            }

            if (targetSection == null) {
                //console.error('Point not on field');
                continue;
            }

            let newSquare = subdivideQuad(targetSection, targetPoint);
            for (let i = 0; i < 5; i++) {
                newSquare = subdivideQuad(newSquare, targetPoint);
            }

            ctx.fillStyle = data[i].predictions[p].class;
            ctx.fillRect(newSquare.p1.worldPoint.x * 40 - 40, (26 - newSquare.p1.worldPoint.y) * 40 - 40, 80, 80);
        }

        ctx.fillStyle = 'white';
        ctx.fillRect(0, canvas.height - 10, canvas.width * (i / data.length), 10);

        encoder.addFrame(ctx);

        if (i % 5 == 0) {
            socketio.emit('status-update', `Gif ${Math.round(i / data.length * 100)}% complete`);
            console.log(Math.round(i / data.length * 100) + '%');
        }

        /*
        // To save frames to temp/frames
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(__dirname + `/src/temp/frames/frame${i}.png`, buffer);
        */
    }
    encoder.finish();
    console.log('Gif complete');
    socketio.emit('status-update', 'Gif complete');
}

// Renders final gif labeling robots
async function renderLabeledFrames(data) {
    var img = await nodecanvas.loadImage(__dirname + '/img/field24.png');

    socketio.emit('status-update', 'Starting gif');

    // Dimensions of frc field: 54' by 26'
    // For testing make it really big
    const canvas = nodecanvas.createCanvas(54 * 40, 26 * 40);
    const ctx = canvas.getContext('2d');

    const encoder = new GIFEncoder(canvas.width, canvas.height);
    encoder.createReadStream().pipe(fs.createWriteStream(__dirname + '/src/temp/output/visualization.gif'));
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(1000 / OUTPUT_FRAMERATE_FPS / SMOOTHING);
    encoder.setQuality(50);

    let strokeColors = ['rgb(31, 206, 255)', 'rgb(133, 188, 255)', 'rgb(64, 61, 245)'];
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (let i = 0; i < data.length - 1; i++) {
        //ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.font = "48px serif";
        ctx.fillStyle = 'grey';
        //ctx.fillRect(0, 0, canvas.width, canvas.height);
        //ctx.drawImage(img, 0, 0, canvas.width, canvas.height);


        for (let p = 0; p < data[i].length; p++) {
            ctx.fillStyle = data[i][p].class;
            ctx.strokeStyle = strokeColors[p];
            //ctx.fillRect(data[i][p].x, data[i][p].y, 60, 60);

            ctx.lineWidth = 15;

            //console.log(data[i + 1].length);

            ctx.beginPath();
            ctx.moveTo(data[i][p].x, data[i][p].y);
            ctx.lineTo(data[i + 1][p].x, data[i + 1][p].y)
            ctx.stroke();

            ctx.fillStyle = 'white';
            //ctx.fillText(p, data[i][p].x, data[i][p].y);
        }

        ctx.fillStyle = 'white';
        ctx.fillRect(0, canvas.height - 10, canvas.width * (i / data.length), 10);

        encoder.addFrame(ctx);

        if (i % 5 == 0) {
            socketio.emit('status-update', `Gif ${Math.round(i / data.length * 100)}% complete`);
            console.log(Math.round(i / data.length * 100) + '%');
        }

        /*
        // To save frames to temp/frames
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(__dirname + `/src/temp/frames/frame${i}.png`, buffer);
        */
    }
    encoder.finish();
    console.log('Gif complete');
    socketio.emit('status-update', 'Gif complete');
}

// Testing with old data
function testRender() {
    let jsonOutput = JSON.parse(fs.readFileSync(__dirname + '/src/temp/robotoutput.json').toString());
    renderFrames(jsonOutput['bumper-detection-b8q8f']);
}

function testField() {
    const image = fs.readFileSync(__dirname + '/src/duluth2.png', {
        encoding: 'base64'
    });

    axios({
        method: 'POST',
        url: 'https://detect.roboflow.com/frc-field/1',
        params: {
            api_key: API_KEY
        },
        data: image,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    })
        .then(function (response) {
            console.log(response.data);
            socketio.emit('send-field-points-2024', response.data);
        })
        .catch(function (error) {
            console.log(error.message);
            socketio.emit('image-error', error.message);
        });
}

function testLabeling() {
    originalSections = [
        {
            "p1": {
                "screenPoint": {
                    "x": 464.404367608027,
                    "y": 511.396875
                },
                "worldPoint": {
                    "x": 0,
                    "y": 26
                }
            },
            "p2": {
                "screenPoint": {
                    "x": 981.15,
                    "y": 487.6875
                },
                "worldPoint": {
                    "x": 20,
                    "y": 26
                }
            },
            "p3": {
                "screenPoint": {
                    "x": 62.054999999999836,
                    "y": 941.625
                },
                "worldPoint": {
                    "x": 0,
                    "y": 0
                }
            },
            "p4": {
                "screenPoint": {
                    "x": 759.5999999999999,
                    "y": 961.875
                },
                "worldPoint": {
                    "x": 20,
                    "y": 0
                }
            }
        },
        {
            "p1": {
                "screenPoint": {
                    "x": 981.15,
                    "y": 487.6875
                },
                "worldPoint": {
                    "x": 20,
                    "y": 26
                }
            },
            "p2": {
                "screenPoint": {
                    "x": 1483.59375,
                    "y": 507.9375
                },
                "worldPoint": {
                    "x": 34,
                    "y": 26
                }
            },
            "p3": {
                "screenPoint": {
                    "x": 759.5999999999999,
                    "y": 961.875
                },
                "worldPoint": {
                    "x": 20,
                    "y": 0
                }
            },
            "p4": {
                "screenPoint": {
                    "x": 1748.6625,
                    "y": 982.125
                },
                "worldPoint": {
                    "x": 34,
                    "y": 0
                }
            }
        },
        {
            "p1": {
                "screenPoint": {
                    "x": 1483.59375,
                    "y": 507.9375
                },
                "worldPoint": {
                    "x": 34,
                    "y": 26
                }
            },
            "p2": {
                "screenPoint": {
                    "x": 1973.386019047953,
                    "y": 552.554625
                },
                "worldPoint": {
                    "x": 54,
                    "y": 26
                }
            },
            "p3": {
                "screenPoint": {
                    "x": 1748.6625,
                    "y": 982.125
                },
                "worldPoint": {
                    "x": 34,
                    "y": 0
                }
            },
            "p4": {
                "screenPoint": {
                    "x": 2446.2075,
                    "y": 982.125
                },
                "worldPoint": {
                    "x": 54,
                    "y": 0
                }
            }
        }
    ];
    labelAlliance('blue', JSON.parse(fs.readFileSync(__dirname + '/src/temp/robotoutput.json').toString()), [93, 3197, 6421]);
}

async function testUserLabeling() {
    await new Promise(resolve => setTimeout(resolve, 1000));

    await getFrame(5, __dirname + '/src/temp/labelingframe.jpg');
    const imgBinary = fs.readFileSync(__dirname + '/src/temp/labelingframe.jpg')

    let jsonOutput = JSON.parse(fs.readFileSync(__dirname + '/src/temp/robotoutput.json').toString());

    // TESTING ONLY
    robotDetectionData = jsonOutput;
    originalSections = [{ "p1": { "screenPoint": { "x": 479.29399347905724, "y": 370.54125 }, "worldPoint": { "x": 0, "y": 26 } }, "p2": { "screenPoint": { "x": 1053.1937500000001, "y": 351 }, "worldPoint": { "x": 20, "y": 26 } }, "p3": { "screenPoint": { "x": 50.859062499999936, "y": 1000.6875 }, "worldPoint": { "x": 0, "y": 0 } }, "p4": { "screenPoint": { "x": 851.265625, "y": 1002.375 }, "worldPoint": { "x": 20, "y": 0 } } }, { "p1": { "screenPoint": { "x": 1053.1937500000001, "y": 351 }, "worldPoint": { "x": 20, "y": 26 } }, "p2": { "screenPoint": { "x": 1575.83125, "y": 352.6875 }, "worldPoint": { "x": 34, "y": 26 } }, "p3": { "screenPoint": { "x": 851.265625, "y": 1002.375 }, "worldPoint": { "x": 20, "y": 0 } }, "p4": { "screenPoint": { "x": 1841.109375, "y": 1004.0625 }, "worldPoint": { "x": 34, "y": 0 } } }, { "p1": { "screenPoint": { "x": 1575.83125, "y": 352.6875 }, "worldPoint": { "x": 34, "y": 26 } }, "p2": { "screenPoint": { "x": 2107.4503229036827, "y": 393.20175 }, "worldPoint": { "x": 54, "y": 26 } }, "p3": { "screenPoint": { "x": 1841.109375, "y": 1004.0625 }, "worldPoint": { "x": 34, "y": 0 } }, "p4": { "screenPoint": { "x": 2641.5159375000003, "y": 1004.0625 }, "worldPoint": { "x": 54, "y": 0 } } }];

    let data = jsonOutput['bumper-detection-b8q8f'];

    let bluePrediction;
    let redPrediction;

    for (let i = 0; i < data.length; i++) {
        let tempPredictions = data[i].predictions;
        tempPredictions = tempPredictions.filter(element => element.class == 'blue');
        if (tempPredictions.length == 3) {
            bluePrediction = JSON.stringify(tempPredictions);
            break;
        }
    }

    // Then validate red robots
    for (let i = 0; i < data.length; i++) {
        let tempPredictions = data[i].predictions;
        tempPredictions = tempPredictions.filter(element => element.class == 'red');
        if (tempPredictions.length == 3) {
            redPrediction = JSON.stringify(tempPredictions);
            break;
        }
    }

    socketio.emit('label-robot', {
        'blue': bluePrediction,
        'red': redPrediction,
        'image': imgBinary
    });
}
//testUserLabeling();

async function requestUserLabeling() {
    await getFrame(5, __dirname + '/src/temp/labelingframe.jpg');
    const imgBinary = fs.readFileSync(__dirname + '/src/temp/labelingframe.jpg')


    let data = robotDetectionData['bumper-detection-b8q8f'];
    let bluePrediction;
    let redPrediction;

    for (let i = 0; i < data.length; i++) {
        let tempPredictions = data[i].predictions;
        tempPredictions = tempPredictions.filter(element => element.class == 'blue');
        if (tempPredictions.length == 3) {
            bluePrediction = JSON.stringify(tempPredictions);
            break;
        }
    }

    // Then validate red robots
    for (let i = 0; i < data.length; i++) {
        let tempPredictions = data[i].predictions;
        tempPredictions = tempPredictions.filter(element => element.class == 'red');
        if (tempPredictions.length == 3) {
            redPrediction = JSON.stringify(tempPredictions);
            break;
        }
    }

    socketio.emit('label-robot', {
        'blue': bluePrediction,
        'red': redPrediction,
        'image': imgBinary
    });
}

async function labelAlliance(color, data, teams) {
    // Delete old output
    try {
        fsExtra.emptyDirSync(__dirname + '/src/temp/output');
        socketio.emit('status-update', 'Emptying folder');
    } catch (e) {
        console.error('Error emptying output folder', e);
    }

    let fullAlliancePredictions = [];
    let frameOffsets = [];
    let imageDimensions = data['bumper-detection-b8q8f'][0].image;
    let imageDiagonal = getDistance({ x: 0, y: 0 }, { x: 54, y: 26 });

    // Only include frames where 3 robots of correct alliance are detected
    for (let i = 0; i < data['bumper-detection-b8q8f'].length; i++) {
        let tempPredictions = data['bumper-detection-b8q8f'][i].predictions;
        tempPredictions = tempPredictions.filter(element => element.class == color);
        if (tempPredictions.length == 3) {
            for (let p = 0; p < tempPredictions.length; p++) {
                let targetPoint = new Point(tempPredictions[p].x + (tempPredictions[p].width / 2), tempPredictions[p].y + (tempPredictions[p].height / 2));
                let targetSection;

                for (let s = 0; s < originalSections.length; s++) {
                    let tempScreenPoints = [originalSections[s].p1.screenPoint, originalSections[s].p2.screenPoint, originalSections[s].p4.screenPoint, originalSections[s].p3.screenPoint];

                    if (pointInPolygon(targetPoint, tempScreenPoints)) {
                        targetSection = originalSections[s];
                        break;
                    }
                }

                if (targetSection == null) {
                    //console.error('Point not on field');
                    continue;
                }

                let newSquare = subdivideQuad(targetSection, targetPoint);
                for (let i = 0; i < 5; i++) {
                    newSquare = subdivideQuad(newSquare, targetPoint);
                }
                tempPredictions[p].x = newSquare.p1.worldPoint.x * 40 - 30;
                tempPredictions[p].y = (26 - newSquare.p1.worldPoint.y) * 40 - 30;
            }

            fullAlliancePredictions.push(tempPredictions);
            frameOffsets.push(data.frame_offset[i]);
        }
    }

    let sortedAllianceFrames = Array.from(Array(fullAlliancePredictions.length), () => new Array(3).fill(0));
    sortedAllianceFrames[0] = fullAlliancePredictions[0];
    for (let i = 1; i < fullAlliancePredictions.length; i++) {
        let sortedDistances = [];
        for (let current = 0; current < fullAlliancePredictions[i].length; current++) {
            for (let old = 0; old < fullAlliancePredictions[i - 1].length; old++) {
                let score = (getDistance(fullAlliancePredictions[i][current], sortedAllianceFrames[i - 1][old]));
                if (isNaN(score)) {
                    console.error('Not a number!');
                    score = 1000000;
                }
                sortedDistances.push({
                    'current': current,
                    'old': old,
                    'distance': parseFloat(score)
                });
            }
        }


        if (fullAlliancePredictions[i - 1].includes(0)) {
            console.error('Uncaught 0');
        }

        sortedDistances.sort((a, b) => a.distance - b.distance);

        while (sortedDistances.length > 0 && sortedDistances[0].distance != 1000000) {
            sortedAllianceFrames[i][sortedDistances[0].old] = fullAlliancePredictions[i][sortedDistances[0].current];
            sortedDistances = sortedDistances.filter(element => element.current !== sortedDistances[0].current && element.old !== sortedDistances[0].old);
        }

        if (sortedAllianceFrames[i].includes(0)) {
            sortedAllianceFrames[i][sortedAllianceFrames[i].indexOf(0)] = sortedAllianceFrames[i - 1][sortedAllianceFrames[i].indexOf(0)];
        }
    }

    let smoothedAllianceFrames = [];
    let newFrameOffsets = [];

    // Now we have all the frames and robots sorted, smooth it out:
    for (let i = 1; i < sortedAllianceFrames.length; i++) {

        // No skipped frames, continue to next
        if (frameOffsets[i] - frameOffsets[i - 1] == 30 / OUTPUT_FRAMERATE_FPS) {
            smoothedAllianceFrames.push(sortedAllianceFrames[i - 1]);
            newFrameOffsets.push(frameOffsets[i - 1]);
            continue;
        }

        // How many frames were skipped
        let elapsedFrames = (frameOffsets[i] - frameOffsets[i - 1]) / (30 / OUTPUT_FRAMERATE_FPS);

        // Create new frames for all those that were skipped
        for (let f = 0; f < elapsedFrames; f++) {
            let estimatedFrame = [];

            // New estimated frames
            for (let p = 0; p < sortedAllianceFrames[i - 1].length; p++) {
                let oldFrame = sortedAllianceFrames[i - 1][p];
                estimatedFrame.push({
                    'class': oldFrame.class,
                    'class_id': oldFrame.class_id,
                    'confidence': -1,
                    'detection_id': 'estimated_frame',
                    'height': oldFrame.height,
                    'width': oldFrame.width,
                    'x': oldFrame.x + ((sortedAllianceFrames[i][p].x - oldFrame.x) * ((f + 1) / (elapsedFrames + 1))),
                    'y': oldFrame.y + ((sortedAllianceFrames[i][p].y - oldFrame.y) * ((f + 1) / (elapsedFrames + 1))),
                });
            }
            smoothedAllianceFrames.push(estimatedFrame);
            newFrameOffsets.push(frameOffsets[i - 1] + f * (30 / OUTPUT_FRAMERATE_FPS));
        }
    }

    // Now save to files
    await exportLabeledFrames(smoothedAllianceFrames, teams, newFrameOffsets);
    //renderLabeledFrames(smoothedAllianceFrames);
}

function exportLabeledFrames(frames, teams, offsets) {
    return new Promise((resolve, reject) => {
        let written = 0;
        for (let i = 0; i < frames[0].length; i++) {
            let currentFrames = [];
            for (let p = 0; p < frames.length; p++) {
                currentFrames.push(frames[p][i]);
            }
            let data = {
                'team': teams[i],
                'alliance': frames[0][i].class,
                'predictions': currentFrames,
                'start': offsets[0],
                'end': offsets[offsets.length - 1]
            }
            let formattedData = JSON.stringify(data);
            writeJSON(`${__dirname}/src/temp/output/robot${teams[i]}.json`, formattedData).then(() => {
                written++;
                if (written >= frames[0].length) {
                    resolve();
                }
            });
        }
    });
}

function writeJSON(dir, data) {
    return new Promise((resolve, reject) => {
        fs.writeFile(dir, data, err => {
            // Checking for errors 
            if (err) reject(err);

            // Success 
            console.log("Done writing");
            socketio.emit('status-update', 'Wrote to ' + dir);
            resolve();
        });
    });
}

//cropVideo(270, 365);