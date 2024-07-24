// Subdivisions/estimation
// Top left, top right, bottom left, bottom right
export function subdivideQuad(points, targetPoint) {
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
export function getIntersectionPoint(p1, p2, p3, p4) {
    var ua, ub, denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (denom == 0) {
        return null;
    }
    ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
    ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
    return new Point(p1.x + ua * (p2.x - p1.x), p1.y + ua * (p2.y - p1.y));
}

export function pointInPolygon(point, polygon) {
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

export function getDistance(p1, p2) {
    //console.log(p2)
    if (p1 == undefined || p2 == undefined || !p1.hasOwnProperty('x') || !p2.hasOwnProperty('x') || !p1.hasOwnProperty('y') || !p2.hasOwnProperty('y')) {
        return NaN;
    }
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

export function getSlope(p1, p2) {
    return (p1.y - p2.y) / (p1.x - p2.x);
}

export function getMidpoint(p1, p2) {
    return new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
}

export function getAngle(A, B, C) {
    var AB = Math.sqrt(Math.pow(B.x - A.x, 2) + Math.pow(B.y - A.y, 2));
    var BC = Math.sqrt(Math.pow(B.x - C.x, 2) + Math.pow(B.y - C.y, 2));
    var AC = Math.sqrt(Math.pow(C.x - A.x, 2) + Math.pow(C.y - A.y, 2));
    return Math.acos((BC * BC + AB * AB - AC * AC) / (2 * BC * AB));
}

export class Point {
    x = 0;
    y = 0;

    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}

export class SectionPoint {
    screenPoint;
    worldPoint;

    constructor(screenPoint, worldPoint) {
        this.screenPoint = screenPoint;
        this.worldPoint = worldPoint;
    }
}

export class SectionGrid {
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