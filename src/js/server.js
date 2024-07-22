import { Server } from 'socket.io';
import { createServer } from 'http';
import express from 'express';
import spawn from 'child_process';
import GIFEncoder from 'gifencoder';

import fs from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
const __dirname = path.resolve();

import fileUpload from 'express-fileupload';
import bodyParser from 'body-parser';
import ffmpeg from 'fluent-ffmpeg';
import extractFrames from 'ffmpeg-extract-frames';

import nodecanvas from 'canvas';
import axios from 'axios';

//import youtubedl from 'youtube-dl-exec';

var videoTimings = {
    start: 0,
    end: 0,
    trim: true,
    second: 1
}

const OUTPUT_FRAMERATE_FPS = 15;
const SMOOTHING = 1;
const API_KEY = '1234';

var robotDetectionData;
var renderCriteria = {
    'hasDistortion': false,
    'hasDetections': false
}
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

const server = createServer(app);
server.listen(PORT, function () {
    console.log(`Server running on port ${PORT}`);
});
const socketio = new Server(server);
// None for now
socketio.on('connection', (socket) => {
    socket.on('send-distortion', function (sections) {
        originalSections = sections;
        console.log(originalSections);
        renderCriteria.hasDistortion = true;
        if (renderCriteria.hasDetections) {
            renderFrames(robotDetectionData);
        }
    });
});

// Start and end times for trim
app.post('/trim', function (req, res) {
    videoTimings = {
        start: req.body.start,
        end: req.body.end,
        trim: req.body.trim,
        second: parseInt(req.body.second) - parseInt(req.body.start)
    }

    console.log(videoTimings);

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

        if (JSON.parse(videoTimings.trim)) {
            trimVideo();
        } else {
            fs.copyFile(__dirname + '/src/temp/untrimmed.mp4', __dirname + '/src/temp/trimmed.mp4', (err) => {
                if (err) throw err;
                console.log('Copied untrimmed video sucessfully');
            });
        }

        res.status(204).send();
    });

});

// Trim the video using ffmpeg
function trimVideo() {
    return new Promise((resolve, reject) => {
        ffmpeg({ source: __dirname + '/src/temp/untrimmed.mp4' })
            .setStartTime(videoTimings.start)
            .duration(videoTimings.end - videoTimings.start)
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

// Video has been trimmed, now run all detections
function runDetections() {
    detectRobots();
    getFrame().then(() => {
        segmentField(2024);
    }).catch((e) => {
        console.error(e);
    })
}

// Promise that saves the specified frame to use for field segmentation
function getFrame() {
    let ms = parseInt(videoTimings.second) * 1000;

    return new Promise(async (resolve, reject) => {
        try {
            await extractFrames({
                input: __dirname + '/src/temp/trimmed.mp4',
                output: __dirname + '/src/temp/fieldframe.jpg',
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
        renderCriteria.hasDetections = true;
        robotDetectionData = jsonOutput['bumper-detection-b8q8f'];

        if (renderCriteria.hasDistortion) {
            //renderFrames(robotDetectionData);
            labelAlliance('blue', jsonOutput);
        }
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

    console.log('Ok.');

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
            ctx.fillRect(data[i][p].x, data[i][p].y, 60, 60);

            ctx.lineWidth = 15;

            //ctx.beginPath();
            //ctx.moveTo(data[i][p].x, data[i][p].y);
            //ctx.lineTo(data[i + 1][p].x, data[i + 1][p].y)
            //ctx.stroke();

            ctx.fillStyle = 'black';
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

// TODO still a work in progress, difficult if there are frames with uneven detections
function renderSmoothFrames(data) {

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
    const canvas = nodecanvas.createCanvas(2534, 1080);
    const ctx = canvas.getContext('2d');

    const encoder = new GIFEncoder(canvas.width, canvas.height);
    encoder.createReadStream().pipe(fs.createWriteStream(__dirname + '/src/temp/output/visualization.gif'));
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(1000 / OUTPUT_FRAMERATE_FPS / SMOOTHING);
    encoder.setQuality(25);

    for (let i = 0; i < data.length - 1; i++) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'grey';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Predictions for this frame and next frame
        let currentFramePredictions = [];
        let nextFramePredictions = [];
        for (let p = 0; p < data[i].predictions.length; p++) {
            // Prediction for this frame
            currentFramePredictions.push(data[i].predictions[p]);

            // Prediction for next frame
            nextFramePredictions.push(data[i + 1].predictions[p]);
        }

        // Sort by x positions first
        currentFramePredictions.sort(({ x: a }, { x: b }) => b - a);
        nextFramePredictions.sort(({ x: a }, { x: b }) => b - a);
        let sortedCurrent = [];
        let sortedNext = [];

        // TODO The robot should really be removed from the array when a closest match is found,
        // However that would fail if there are uneven (2 vs 3) predictions, one would be let out. Fix later.
        for (let currentP = 0; currentP < currentFramePredictions.length; currentP++) {
            // If next frame has no predictions then skip, still will break algorithm
            // TODO fix later
            //if (nextFramePredictions.length == 0) {
            //break;
            //}

            // Closest robot in next frame
            let closestLength = 1000000;
            let closestIndex = 0;

            // Check if there are any closer than first
            for (let nextP = 0; nextP < nextFramePredictions.length; nextP++) {

                // If they are on different alliances then skip
                if (currentFramePredictions[currentP].class_id != nextFramePredictions[nextP].class_id) {
                    continue;
                }

                // Check if length of current next prediction is closer
                let nextLength = getDistance(currentFramePredictions[currentP], nextFramePredictions[nextP]);
                if (nextLength < closestLength) {
                    // Update closest robot
                    closestIndex = nextP;
                    closestLength = nextLength;
                }
            }
            sortedCurrent.push(currentFramePredictions[currentP]);
            sortedNext.push(nextFramePredictions[closestIndex]);
        }

        //console.log(sortedCurrent);
        //console.log('\n\n\n')
        //console.log(sortedNext);

        // Add estimates between frames to smooth out motion
        for (let e = 0; e < SMOOTHING; e++) {

            // Iterate through each prediction
            for (let k = 0; k < sortedCurrent.length; k++) {

                let smoothedX = ((sortedCurrent[k].x - sortedNext[k].x) / SMOOTHING * e) + sortedNext[k].x;
                let smoothedY = ((sortedCurrent[k].y - sortedNext[k].y) / SMOOTHING * e) + sortedNext[k].y;

                ctx.fillStyle = sortedCurrent[k].class;
                ctx.fillRect(smoothedX - 30, smoothedY - 30, 60, 60)
            }

            encoder.addFrame(ctx);
        }

        if (i % 5 == 0) {
            socketio.emit('status-update', `Gif ${Math.round(i / data.length * 100)}% complete`);
            console.log(Math.round(i / data.length * 100));
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
    originalSections = [{"p1":{"screenPoint":{"x":479.29399347905724,"y":370.54125},"worldPoint":{"x":0,"y":26}},"p2":{"screenPoint":{"x":1053.1937500000001,"y":351},"worldPoint":{"x":20,"y":26}},"p3":{"screenPoint":{"x":50.859062499999936,"y":1000.6875},"worldPoint":{"x":0,"y":0}},"p4":{"screenPoint":{"x":851.265625,"y":1002.375},"worldPoint":{"x":20,"y":0}}},{"p1":{"screenPoint":{"x":1053.1937500000001,"y":351},"worldPoint":{"x":20,"y":26}},"p2":{"screenPoint":{"x":1575.83125,"y":352.6875},"worldPoint":{"x":34,"y":26}},"p3":{"screenPoint":{"x":851.265625,"y":1002.375},"worldPoint":{"x":20,"y":0}},"p4":{"screenPoint":{"x":1841.109375,"y":1004.0625},"worldPoint":{"x":34,"y":0}}},{"p1":{"screenPoint":{"x":1575.83125,"y":352.6875},"worldPoint":{"x":34,"y":26}},"p2":{"screenPoint":{"x":2107.4503229036827,"y":393.20175},"worldPoint":{"x":54,"y":26}},"p3":{"screenPoint":{"x":1841.109375,"y":1004.0625},"worldPoint":{"x":34,"y":0}},"p4":{"screenPoint":{"x":2641.5159375000003,"y":1004.0625},"worldPoint":{"x":54,"y":0}}}];
    labelAlliance('blue', JSON.parse(fs.readFileSync(__dirname + '/src/temp/robotoutput.json').toString()));
}

function labelAlliance(color, data) {
    let fullAlliancePredictions = [];
    let frameOffsets = [];
    let imageDimensions = data['bumper-detection-b8q8f'][0].image;
    let imageDiagonal = getDistance({ x: 0, y: 0 }, { x: 54, y: 26 });

    // Only include frames where 3 robots of correct alliance are detected
    for (let i = 0; i < data['bumper-detection-b8q8f'].length/1; i++) {
        let tempPredictions = data['bumper-detection-b8q8f'][i].predictions;
        tempPredictions = tempPredictions.filter(element => element.class == color);
        if ((tempPredictions.length == -1 && fullAlliancePredictions.length > 1) || tempPredictions.length == 3) {
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
                if(isNaN(score)) {
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

        if(fullAlliancePredictions[i-1].includes(0)) {
            console.error('Uncaught 0');
        }

        sortedDistances.sort((a, b) => a.distance - b.distance);

        //console.log(sortedDistances);

        while (sortedDistances.length > 0 && sortedDistances[0].distance != 1000000) {
            sortedAllianceFrames[i][sortedDistances[0].old] = fullAlliancePredictions[i][sortedDistances[0].current];
            sortedDistances = sortedDistances.filter(element => element.current !== sortedDistances[0].current && element.old !== sortedDistances[0].old);
        }

        if(sortedAllianceFrames[i].includes(0)) {
            sortedAllianceFrames[i][sortedAllianceFrames[i].indexOf(0)] = sortedAllianceFrames[i-1][sortedAllianceFrames[i].indexOf(0)];
        }
    }

    //console.log(sortedAllianceFrames);

    //console.log(sortedAllianceFrames[0]);
    //console.log('\n');
    //console.log(sortedAllianceFrames);

    renderLabeledFrames(sortedAllianceFrames);
}


// Subdivisions/estimation
// Top left, top right, bottom left, bottom right
function subdivideQuad(points, targetPoint) {
    points = [points.p1, points.p2, points.p3, points.p4];

    let centerPoint = new SectionPoint(getIntersectionPoint(points[0].screenPoint, points[3].screenPoint, points[1].screenPoint, points[2].screenPoint), getMidpoint(points[0].worldPoint, points[3].worldPoint));

    let vanishingPoint = getIntersectionPoint(points[0].screenPoint, points[2].screenPoint, points[1].screenPoint, points[3].screenPoint);
    let secondVanishingPoint = getIntersectionPoint(points[0].screenPoint, points[1].screenPoint, points[2].screenPoint, points[3].screenPoint);

    let nextLeft = new SectionPoint(getIntersectionPoint(secondVanishingPoint, centerPoint.screenPoint, points[0].screenPoint, points[2].screenPoint), getMidpoint(points[0].worldPoint, points[2].worldPoint));

    let nextRight = new SectionPoint(getIntersectionPoint(secondVanishingPoint, centerPoint.screenPoint, points[1].screenPoint, points[3].screenPoint), getMidpoint(points[1].worldPoint, points[3].worldPoint));

    let nextTop = new SectionPoint(getIntersectionPoint(vanishingPoint, centerPoint.screenPoint, points[0].screenPoint, points[1].screenPoint), getMidpoint(points[0].worldPoint, points[1].worldPoint));

    let nextBottom = new SectionPoint(getIntersectionPoint(vanishingPoint, centerPoint.screenPoint, points[2].screenPoint, points[3].screenPoint), getMidpoint(points[2].worldPoint, points[3].worldPoint));

    let sections = [
        new SectionGrid(points[0], nextTop, nextLeft, centerPoint),
        new SectionGrid(nextTop, points[1], centerPoint, nextRight),
        new SectionGrid(nextLeft, centerPoint, points[2], nextBottom),
        new SectionGrid(centerPoint, nextRight, nextBottom, points[3])
    ];

    for (let i = 0; i < 4; i++) {
        if (pointInPolygon(targetPoint, [sections[i].p1.screenPoint, sections[i].p2.screenPoint, sections[i].p4.screenPoint, sections[i].p3.screenPoint])) {
            return sections[i];
        }
    }

    // Should never happen but you never know
    console.error('Point not found in any subdivisions');
    return null;
}

// Returns intersection point of line through p1 + p2 and line through p3 + p4
function getIntersectionPoint(p1, p2, p3, p4) {
    var ua, ub, denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (denom == 0) {
        return null;
    }
    ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
    ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
    return new Point(p1.x + ua * (p2.x - p1.x), p1.y + ua * (p2.y - p1.y));
}

function pointInPolygon(point, polygon) {
    const num_vertices = polygon.length;
    const x = point.x;
    const y = point.y;
    let inside = false;

    let p1 = polygon[0];
    let p2;

    for (let i = 1; i <= num_vertices; i++) {
        p2 = polygon[i % num_vertices];

        if (y > Math.min(p1.y, p2.y)) {
            if (y <= Math.max(p1.y, p2.y)) {
                if (x <= Math.max(p1.x, p2.x)) {
                    const x_intersection = ((y - p1.y) * (p2.x - p1.x)) / (p2.y - p1.y) + p1.x;

                    if (p1.x === p2.x || x <= x_intersection) {
                        inside = !inside;
                    }
                }
            }
        }

        p1 = p2;
    }

    return inside;
}

function getDistance(p1, p2) {
    console.log(p2)
    if(p1 == undefined || p2 == undefined || !p1.hasOwnProperty('x') || !p2.hasOwnProperty('x') || !p1.hasOwnProperty('y') || !p2.hasOwnProperty('y')) {
        return NaN;
    }
    return Math.sqrt(Math.pow(p1.x - p2.x, 2), Math.pow(p1.y - p2.y, 2));
}

function getSlope(p1, p2) {
    return (p1.y - p2.y) / (p1.x - p2.x);
}

function getMidpoint(p1, p2) {
    return new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
}

function getAngle(A, B, C) {
    var AB = Math.sqrt(Math.pow(B.x - A.x, 2) + Math.pow(B.y - A.y, 2));
    var BC = Math.sqrt(Math.pow(B.x - C.x, 2) + Math.pow(B.y - C.y, 2));
    var AC = Math.sqrt(Math.pow(C.x - A.x, 2) + Math.pow(C.y - A.y, 2));
    return Math.acos((BC * BC + AB * AB - AC * AC) / (2 * BC * AB));
}

class Point {
    x = 0;
    y = 0;

    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}

class SectionPoint {
    screenPoint;
    worldPoint;

    constructor(screenPoint, worldPoint) {
        this.screenPoint = screenPoint;
        this.worldPoint = worldPoint;
    }
}

class SectionGrid {
    p1;
    p2;
    p3;
    p4;

    constructor(p1, p2, p3, p4) {
        this.p1 = p1;
        this.p2 = p2;
        this.p3 = p3;
        this.p4 = p4;
    }
}

testLabeling();