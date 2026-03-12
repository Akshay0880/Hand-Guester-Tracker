/**
 * Modern Hand Gesture Tracker - Drag and Drop
 * Uses MediaPipe Hands to track hand landmarks and control a virtual cursor.
 */

class HandTracker {
    constructor() {
        // DOM Elements
        this.videoElement = document.querySelector('.input_video');
        this.canvasElement = document.querySelector('.output_canvas');
        this.canvasCtx = this.canvasElement.getContext('2d');
        this.cursorElement = document.getElementById('virtual-cursor');
        this.statusText = document.getElementById('status-text');
        
        // Tracking State Object
        this.cursorPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        this.targetPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        this.isPinching = false;
        this.handVisible = false;
        
        // Configuration
        this.smoothingFactor = 0.35; // Interpolation factor
        this.pinchThreshold = 0.05; // 3D distance threshold for pinch detection
        
        // Interaction State
        this.hoverElement = null; // Element currently under the cursor
        this.grabbedElement = null; // Element currently being dragged
        this.grabOffset = { x: 0, y: 0 }; // Offset to prevent element snapping to cursor origin
        
        this.init();
        this.setupMouseFallback();
    }
    
    async init() {
        this.statusText.textContent = "Status: Loading MediaPipe Models...";
        this.statusText.style.color = "#fbbf24"; 
        
        // Initialize MediaPipe Hands
        const hands = new window.Hands({locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }});
        
        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.7
        });
        
        hands.onResults(this.onResults.bind(this));
        
        // Initialize Camera
        const camera = new window.Camera(this.videoElement, {
            onFrame: async () => {
                await hands.send({image: this.videoElement});
            },
            width: 640,
            height: 480
        });
        
        try {
            // Explicitly request camera permissions first
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480 } 
            });
            this.videoElement.srcObject = stream;
            
            // Wait for video to be ready before starting MediaPipe
            await new Promise((resolve) => {
                this.videoElement.onloadedmetadata = () => {
                    this.videoElement.play();
                    resolve();
                };
            });

            // Re-initialize Camera utility with the playing element
            const camera = new window.Camera(this.videoElement, {
                onFrame: async () => {
                    await hands.send({image: this.videoElement});
                },
                width: 640,
                height: 480
            });
            
            await camera.start();
            this.statusText.textContent = "Status: Tracking...";
            this.statusText.style.color = "#4ade80"; 
            
            // Start the cursor animation loop
            requestAnimationFrame(this.updateCursor.bind(this));
        } catch (error) {
            console.error("Camera access denied or error:", error);
            this.statusText.textContent = `Error: ${error.message || "Camera access denied. Please allow permissions."}`;
            this.statusText.style.color = "#ff003c";
            
            // Add helpful tip to status if it might be a protocol issue
            if (window.location.protocol === 'file:') {
                setTimeout(() => {
                    this.statusText.textContent = "Note: Browsers block cameras on file:// URLs. Use a live server (Localhost).";
                }, 3000);
            }
        }
    }
    
    // Allows testing with standard mouse drag as fallback
    setupMouseFallback() {
        const cards = document.querySelectorAll('.draggable-card');
        
        cards.forEach(card => {
            let isDragging = false;
            let startX, startY, initialLeft, initialTop;
            
            card.addEventListener('mousedown', (e) => {
                // If mediated by gesture, ignore standard native behavior
                if(!e.isTrusted) return; 
                
                isDragging = true;
                card.classList.add('grabbed');
                const style = window.getComputedStyle(card);
                initialLeft = parseInt(style.left, 10);
                initialTop = parseInt(style.top, 10);
                startX = e.clientX;
                startY = e.clientY;
            });
            
            window.addEventListener('mousemove', (e) => {
                if (!isDragging || !e.isTrusted) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                card.style.left = `${initialLeft + dx}px`;
                card.style.top = `${initialTop + dy}px`;
            });
            
            window.addEventListener('mouseup', () => {
                if(isDragging) {
                    isDragging = false;
                    card.classList.remove('grabbed');
                }
            });
        });
    }
    
    // Callback running every time the model processes a camera frame
    onResults(results) {
        this.canvasCtx.save();
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        
        // Mirror canvas
        this.canvasCtx.translate(this.canvasElement.width, 0);
        this.canvasCtx.scale(-1, 1);
        
        this.canvasCtx.drawImage(
            results.image, 0, 0, this.canvasElement.width, this.canvasElement.height);
            
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            this.handVisible = true;
            this.cursorElement.classList.add('active');
            
            const landmarks = results.multiHandLandmarks[0];
            
            // Draw skeleton
            window.drawConnectors(this.canvasCtx, landmarks, window.HAND_CONNECTIONS,
                                {color: 'rgba(0, 240, 255, 0.5)', lineWidth: 2});
            window.drawLandmarks(this.canvasCtx, landmarks, 
                                {color: '#00f0ff', lineWidth: 1, radius: 2});
            
            this.processGestures(landmarks);
            
        } else {
            // Hand disappeared
            if (this.handVisible) {
                this.handVisible = false;
                this.cursorElement.classList.remove('active');
                
                // Clear state
                if (this.hoverElement) {
                    this.hoverElement.classList.remove('hover-state');
                    this.hoverElement = null;
                }
                
                // Drop if dragging
                if(this.grabbedElement) {
                    this.onPinchEnd();
                }
            }
        }
        
        this.canvasCtx.restore();
    }
    
    processGestures(landmarks) {
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        
        /* 1. Cursor Movement */
        const screenX = (1 - indexTip.x) * window.innerWidth;
        const screenY = indexTip.y * window.innerHeight;
        
        this.targetPosition = { x: screenX, y: screenY };
        
        /* 2. Pinch Detection */
        const dx = indexTip.x - thumbTip.x;
        const dy = indexTip.y - thumbTip.y;
        const dz = indexTip.z - thumbTip.z;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        const wasPinching = this.isPinching;
        this.isPinching = distance < this.pinchThreshold;
        
        if (this.isPinching && !wasPinching) {
            this.onPinchStart();
        } else if (!this.isPinching && wasPinching) {
            this.onPinchEnd();
        }
    }
    
    // Main animation loop
    updateCursor() {
        if (this.handVisible) {
            // Apply smoothing
            this.cursorPosition.x += (this.targetPosition.x - this.cursorPosition.x) * this.smoothingFactor;
            this.cursorPosition.y += (this.targetPosition.y - this.cursorPosition.y) * this.smoothingFactor;
            
            this.cursorElement.style.left = `${this.cursorPosition.x}px`;
            this.cursorElement.style.top = `${this.cursorPosition.y}px`;
            
            if (this.isPinching) {
                this.cursorElement.classList.add('pinching');
            } else {
                this.cursorElement.classList.remove('pinching');
            }
            
            // If dragging, apply position to the dragged card
            if (this.grabbedElement) {
                this.grabbedElement.style.left = `${this.cursorPosition.x - this.grabOffset.x}px`;
                this.grabbedElement.style.top = `${this.cursorPosition.y - this.grabOffset.y}px`;
            } else {
                // Otherwise check hover targets
                this.checkHoverElements();
            }
        }
        
        requestAnimationFrame(this.updateCursor.bind(this));
    }
    
    checkHoverElements() {
        this.cursorElement.style.display = 'none';
        const elementsAtPoint = document.elementsFromPoint(this.cursorPosition.x, this.cursorPosition.y);
        this.cursorElement.style.display = 'block';
        
        const interactive = elementsAtPoint.find(el => el.classList.contains('interactive-element'));
        
        if (interactive !== this.hoverElement) {
            if (this.hoverElement) {
                this.hoverElement.classList.remove('hover-state');
            }
            this.hoverElement = interactive;
            if (this.hoverElement) {
                this.hoverElement.classList.add('hover-state');
            }
        }
    }
    
    onPinchStart() {
        if (this.hoverElement && this.hoverElement.classList.contains('draggable-card')) {
            // Grab the card
            this.grabbedElement = this.hoverElement;
            this.grabbedElement.classList.add('grabbed');
            
            // Calculate where on the card we grabbed it so it doesn't snap abruptly
            const rect = this.grabbedElement.getBoundingClientRect();
            this.grabOffset = {
                x: this.cursorPosition.x - rect.left,
                y: this.cursorPosition.y - rect.top
            };
        }
    }
    
    onPinchEnd() {
        // Drop the card
        if (this.grabbedElement) {
            this.grabbedElement.classList.remove('grabbed');
            this.grabbedElement = null;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new HandTracker();
});
