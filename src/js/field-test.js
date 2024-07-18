var socket = io();
socket.on('send-field-points-2024', handleValues);

const distortionSlider = document.getElementById('distortion-slider');
distortionSlider.style.display = 'none';
distortionSlider.addEventListener('input', updateDistortion);

const canvas = document.getElementById('test-canvas');
const ctx = canvas.getContext('2d');
var canvasImage;
var hull;
var corners;
var segmentationData;
var originalSections = [];

canvas.addEventListener('click', handleCanvasClick);

async function handleValues(data) {
    console.log(data);
    segmentationData = data;

    const points = segmentationData.predictions[0].points;
    hull = convexhull.makeHull(points);

    canvas.width = data.image.width;
    canvas.height = data.image.height;

    await loadImage('../duluth2.png').then(image =>
        canvasImage = image
    );

    corners = getInnerFieldCorners();
    renderPoints();

    distortionSlider.style.display = 'block';
}

function getInnerFieldCorners() {
    let sortedX = hull.toSorted(({ x: a }, { x: b }) => a - b);
    let sortedY = hull.toSorted(({ y: a }, { y: b }) => a - b);

    let topPoint = sortedY[0];
    let bottomPoint = sortedY[sortedY.length - 1];
    let leftPoint = sortedX[0];
    let rightPoint = sortedY[sortedX.length - 1];
    let topIndex = 0;
    let bottomIndex = 0;
    let innerCorners = [];
    let outerCorners = new Array(4);

    let largeArray = [...hull, ...hull, ...hull];

    ctx.fillStyle = `rgb(0, 0, 255)`;
    ctx.fillRect(topPoint.x - 5, topPoint.y - 5, 10, 10);
    ctx.fillRect(bottomPoint.x - 5, bottomPoint.y - 5, 10, 10);

    for (let i = 0; i < hull.length; i++) {
        if (hull[i] == topPoint) {
            topIndex = i;
        }

        if (hull[i] == bottomPoint) {
            bottomIndex = i;
        }
    }

    // Top left
    for (let i = topIndex + hull.length; i < largeArray.length - 1; i++) {
        let slopeToNext = getSlope(largeArray[i], largeArray[i + 1]);
        slopeToNext *= -1;
        if (slopeToNext > 0.25) {
            innerCorners.push({
                'point': largeArray[i],
                index: i
            });
            break;
        }
    }

    // Top right
    for (let i = topIndex + hull.length; i > 0; i--) {
        let slopeToNext = getSlope(largeArray[i], largeArray[i - 1]);
        slopeToNext *= -1;
        if (slopeToNext < -0.25) {
            innerCorners.push({
                'point': largeArray[i],
                index: i
            });
            break;
        }
    }

    /*
    // Bottom left
    innerCorners.push({
        'point': leftPoint,
        index: hull.length
    });

    // Bottom right
    innerCorners.push({
        'point': rightPoint,
        index: hull.length - 1
    });
    */

    /*
    You could find procedurally, but it should be the least and most on the x axis
    */

    // Bottom left
    for (let i = bottomIndex + hull.length; i > 0; i--) {
        let slopeToNext = getSlope(largeArray[i], largeArray[i - 1]);
        slopeToNext *= -1;
        if (slopeToNext > 0.25 || slopeToNext < -0.75) {
            innerCorners.push({
                'point': largeArray[i],
                index: i
            });
            break;
        }
    }

    // Bottom right
    for (let i = bottomIndex + hull.length; i < largeArray.length - 1; i++) {
        let slopeToNext = getSlope(largeArray[i], largeArray[i + 1]);
        slopeToNext *= -1;
        if (slopeToNext < -0.25) {
            innerCorners.push({
                'point': largeArray[i],
                index: i
            });
            break;
        }
    }

    // Vanishing point
    let vanishingPoint = getIntersectionPoint(innerCorners[0].point, innerCorners[2].point, innerCorners[1].point, innerCorners[3].point);

    // Bottom left
    outerCorners[2] = new Point(innerCorners[2].point.x - (0.75 * getDistance(innerCorners[2].point, innerCorners[3].point) * (1 - getSlope(innerCorners[2].point, innerCorners[3].point))), innerCorners[2].point.y - (getDistance(innerCorners[2].point, innerCorners[3].point) * (getSlope(innerCorners[2].point, innerCorners[3].point))));

    // Bottom right
    outerCorners[3] = new Point(innerCorners[3].point.x + (0.75 * getDistance(innerCorners[2].point, innerCorners[3].point) * (1 - getSlope(innerCorners[2].point, innerCorners[3].point))), innerCorners[2].point.y + (getDistance(innerCorners[2].point, innerCorners[3].point) * (getSlope(innerCorners[2].point, innerCorners[3].point))));

    // Top left
    outerCorners[0] = new Point(outerCorners[2].x + ((1 - getSlope(outerCorners[2], vanishingPoint)) * (innerCorners[0].point.x - innerCorners[2].point.x)), innerCorners[2].point.y + (distortionSlider.value * (innerCorners[0].point.y - innerCorners[2].point.y)));

    // Top right
    outerCorners[1] = new Point(outerCorners[3].x - ((1 + getSlope(outerCorners[3], vanishingPoint)) * -(innerCorners[1].point.x - innerCorners[3].point.x)), (innerCorners[3].point.y + (distortionSlider.value * (innerCorners[1].point.y - innerCorners[3].point.y))) + (1 + getSlope(innerCorners[0].point, innerCorners[1].point)) * getDistance(innerCorners[0].point, innerCorners[1].point) / 25);

    originalSections = [
        new SectionGrid(new SectionPoint(outerCorners[0], new Point(0, 26)), new SectionPoint(innerCorners[0].point, new Point(20, 26)), new SectionPoint(outerCorners[2], new Point(0, 0)), new SectionPoint(innerCorners[2].point, new Point(20, 0))),
        new SectionGrid(new SectionPoint(innerCorners[0].point, new Point(20, 26)), new SectionPoint(innerCorners[1].point, new Point(34, 26)), new SectionPoint(innerCorners[2].point, new Point(20, 0)), new SectionPoint(innerCorners[3].point, new Point(34, 0))),
        new SectionGrid(new SectionPoint(innerCorners[1].point, new Point(34, 26)), new SectionPoint(outerCorners[1], new Point(54, 26)), new SectionPoint(innerCorners[3].point, new Point(34, 0)), new SectionPoint(outerCorners[3], new Point(54, 0))),
    ]

    return {
        'innerCorners': innerCorners,
        'outerCorners': outerCorners
    };
}

function updateDistortion() {
    let innerCorners = corners.innerCorners;
    let outerCorners = new Array(4);

    let vanishingPoint = getIntersectionPoint(innerCorners[0].point, innerCorners[2].point, innerCorners[1].point, innerCorners[3].point);

    // Bottom left
    outerCorners[2] = new Point(innerCorners[2].point.x - (0.75 * getDistance(innerCorners[2].point, innerCorners[3].point) * (1 - getSlope(innerCorners[2].point, innerCorners[3].point))), innerCorners[2].point.y - (getDistance(innerCorners[2].point, innerCorners[3].point) * (getSlope(innerCorners[2].point, innerCorners[3].point))));

    // Bottom right
    outerCorners[3] = new Point(innerCorners[3].point.x + (0.75 * getDistance(innerCorners[2].point, innerCorners[3].point) * (1 - getSlope(innerCorners[2].point, innerCorners[3].point))), innerCorners[2].point.y + (getDistance(innerCorners[2].point, innerCorners[3].point) * (getSlope(innerCorners[2].point, innerCorners[3].point))));

    // Top left
    outerCorners[0] = new Point(outerCorners[2].x + ((1 - getSlope(outerCorners[2], vanishingPoint)) * (innerCorners[0].point.x - innerCorners[2].point.x)), innerCorners[2].point.y + (this.value * (innerCorners[0].point.y - innerCorners[2].point.y)));

    // Top right
    outerCorners[1] = new Point(outerCorners[3].x - ((1 + getSlope(outerCorners[3], vanishingPoint)) * -(innerCorners[1].point.x - innerCorners[3].point.x)), (innerCorners[3].point.y + (this.value * (innerCorners[1].point.y - innerCorners[3].point.y))) + (1 + getSlope(innerCorners[0].point, innerCorners[1].point)) * getDistance(innerCorners[0].point, innerCorners[1].point) / 25);

    originalSections = [
        new SectionGrid(new SectionPoint(outerCorners[0], new Point(0, 26)), new SectionPoint(innerCorners[0].point, new Point(20, 26)), new SectionPoint(outerCorners[2], new Point(0, 0)), new SectionPoint(innerCorners[2].point, new Point(20, 0))),
        new SectionGrid(new SectionPoint(innerCorners[0].point, new Point(20, 26)), new SectionPoint(innerCorners[1].point, new Point(34, 26)), new SectionPoint(innerCorners[2].point, new Point(20, 0)), new SectionPoint(innerCorners[3].point, new Point(34, 0))),
        new SectionGrid(new SectionPoint(innerCorners[1].point, new Point(34, 26)), new SectionPoint(outerCorners[1], new Point(54, 26)), new SectionPoint(innerCorners[3].point, new Point(34, 0)), new SectionPoint(outerCorners[3], new Point(54, 0))),
    ]

    corners.outerCorners = outerCorners;
    renderPoints();
}

function renderPoints() {
    ctx.drawImage(canvasImage, 0, 0);

    for (let i = 0; i < hull.length; i++) {
        ctx.fillStyle = `rgb(${i / hull.length * 255}, 0, 0)`;
        ctx.fillRect(hull[i].x - 5, hull[i].y - 5, 10, 10);
    }

    // Top left, top right, bottom left, bottom right
    let innerCorners = corners.innerCorners;
    let outerCorners = corners.outerCorners;

    for (let i = 0; i < innerCorners.length; i++) {
        ctx.fillStyle = `rgb(${i / innerCorners.length * 255}, 255, 0)`;
        ctx.fillRect(innerCorners[i].point.x - 5, innerCorners[i].point.y - 5, 10, 10);
    }

    for (let i = 0; i < outerCorners.length; i++) {
        ctx.fillStyle = `rgb(${i / outerCorners.length * 255}, 255, 0)`;
        ctx.fillRect(outerCorners[i].x - 5, outerCorners[i].y - 5, 10, 10);
    }
}


// Top left, top right, bottom left, bottom right
function subdivideQuad(points, targetPoint) {
    points = [points.p1, points.p2, points.p3, points.p4];

    let centerPoint = new SectionPoint(getIntersectionPoint(points[0].screenPoint, points[3].screenPoint, points[1].screenPoint, points[2].screenPoint), getMidpoint(points[0].worldPoint, points[3].worldPoint));
    ctx.fillRect(centerPoint.screenPoint.x - 5, centerPoint.screenPoint.y - 5, 10, 10);

    let vanishingPoint = getIntersectionPoint(points[0].screenPoint, points[2].screenPoint, points[1].screenPoint, points[3].screenPoint);
    let secondVanishingPoint = getIntersectionPoint(points[0].screenPoint, points[1].screenPoint, points[2].screenPoint, points[3].screenPoint);

    let nextLeft =  new SectionPoint(getIntersectionPoint(secondVanishingPoint, centerPoint.screenPoint, points[0].screenPoint, points[2].screenPoint), getMidpoint(points[0].worldPoint, points[2].worldPoint));
    ctx.fillRect(nextLeft.screenPoint.x - 5, nextLeft.screenPoint.y - 5, 10, 10);

    let nextRight = new SectionPoint(getIntersectionPoint(secondVanishingPoint, centerPoint.screenPoint, points[1].screenPoint, points[3].screenPoint), getMidpoint(points[1].worldPoint, points[3].worldPoint));
    ctx.fillRect(nextRight.screenPoint.x - 5, nextRight.screenPoint.y - 5, 10, 10);

    let nextTop = new SectionPoint(getIntersectionPoint(vanishingPoint, centerPoint.screenPoint, points[0].screenPoint, points[1].screenPoint), getMidpoint(points[0].worldPoint, points[1].worldPoint));
    ctx.fillRect(nextTop.screenPoint.x - 5, nextTop.screenPoint.y - 5, 10, 10);

    let nextBottom = new SectionPoint(getIntersectionPoint(vanishingPoint, centerPoint.screenPoint, points[2].screenPoint, points[3].screenPoint), getMidpoint(points[2].worldPoint, points[3].worldPoint));
    ctx.fillRect(nextBottom.screenPoint.x - 5, nextBottom.screenPoint.y - 5, 10, 10);

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

function handleCanvasClick(e) {
    let rect = e.target.getBoundingClientRect();

    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    let mousePoint = new Point(x, y);

    let targetSection;

    for (let i = 0; i < originalSections.length; i++) {
        let tempScreenPoints = [originalSections[i].p1.screenPoint, originalSections[i].p2.screenPoint, originalSections[i].p4.screenPoint, originalSections[i].p3.screenPoint];

        if (pointInPolygon(mousePoint, tempScreenPoints)) {
            targetSection = originalSections[i];
            break;
        }
    }

    if (targetSection == null) {
        console.error('Point not on field');
        return;
    }

    let newSquare = subdivideQuad(targetSection, mousePoint);
    for(let i = 0; i < 5; i ++) {
        newSquare = subdivideQuad(newSquare, mousePoint);
    }
}

const loadImage = src =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });

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

// Returns if point is inside polygon, array of points
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

function getSlope(p1, p2) {
    return (p1.y - p2.y) / (p1.x - p2.x);
}

function getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2), Math.pow(p1.y - p2.y, 2));
}

function getMidpoint(p1, p2) {
    return new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
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