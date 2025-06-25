const BASE_URL = "http://localhost:8030/v1/api"; // Updated BASE_URL with /v1/api prefix

let fullTranscript = "";
let currentQuizQuestion = null; // To store current quiz question for evaluation
let chatHistory = []; // Already exists, but explicitly defined here for clarity
let studentLessonData = { // Initial student data for analytics
    quiz_scores: [],
    video_watched_percentage: 0.0,
    explanations_requested_count: 0,
    quiz_attempts_count: 0,
    time_spent_minutes: 0.0,
    total_lecture_duration_minutes: 1.0, // Default to 1 to prevent division by zero
    difficult_concepts: []
};

// --- UI Helpers ---
function showOverlay(sectionId, state, message = '') {
    const sectionElement = document.getElementById(sectionId);
    if (!sectionElement) return;

    let overlay = sectionElement.querySelector('.loading-overlay');
    if (!overlay) {
        // Create overlay if it doesn't exist
        overlay = document.createElement('div');
        overlay.className = 'loading-overlay hidden';
        overlay.innerHTML = '<span class="loader"></span><span></span>';
        sectionElement.style.position = 'relative'; // Ensure section is positioned for overlay
        sectionElement.appendChild(overlay);
    }
    
    overlay.classList.toggle('hidden', !state);
    if (message) {
        overlay.querySelector('span:last-child').textContent = message;
    }
}

function showGlobalMessage(message, type = 'info') { // type: 'info', 'success', 'error'
    const msgDiv = document.getElementById('global-message');
    msgDiv.textContent = message;
    msgDiv.className = type + '-message'; // Apply class for styling
    msgDiv.style.display = 'block'; // Use 'block' for visibility
    setTimeout(() => { msgDiv.style.display = 'none'; }, type === 'error' ? 5000 : 3000); // Display longer for errors
}

// Function to update sidebar stats
function updateSidebarStats() {
    // This is placeholder logic, actual values would come from backend or complex client-side tracking
    document.getElementById('lessons-num').textContent = 1; // Assuming 1 lesson processed
    document.getElementById('quiz-num').textContent = studentLessonData.quiz_attempts_count;
    document.getElementById('minutes-num').textContent = Math.round(studentLessonData.time_spent_minutes);

    // Placeholder for progress fill based on video watched percentage
    const progressFill = document.querySelector('.progress-fill');
    if (progressFill) {
        progressFill.style.width = `${studentLessonData.video_watched_percentage * 100}%`;
    }
}

// ---- VIDEO UPLOAD & TRANSCRIBE ----
async function uploadVideo() {
    const fileInput = document.getElementById('videoFile');
    const videoLanguageSelect = document.getElementById('videoLanguage');
    const selectedLanguage = videoLanguageSelect.value === 'auto' ? null : videoLanguageSelect.value;

    if (!fileInput.files[0]) {
        showGlobalMessage("الرجاء اختيار ملف فيديو أولاً.", 'error'); // Arabic error message
        return;
    }

    // Show video player immediately
    const videoFile = fileInput.files[0];
    const videoURL = URL.createObjectURL(videoFile);
    const videoPlayer = document.getElementById('video-player');
    videoPlayer.src = videoURL;
    document.getElementById('video-section').style.display = '';

    // Get video duration once metadata is loaded
    videoPlayer.onloadedmetadata = () => {
        studentLessonData.total_lecture_duration_minutes = videoPlayer.duration / 60;
        console.log("Video duration loaded:", studentLessonData.total_lecture_duration_minutes);
    };

    showOverlay('transcript-section', true, 'جاري التفريغ...'); // Show overlay on transcript section
    showGlobalMessage("جاري تحميل وتفريغ الفيديو، قد يستغرق هذا بعض الوقت...", 'info');

    const formData = new FormData();
    formData.append("file", videoFile);
    if (selectedLanguage) {
        formData.append("language", selectedLanguage);
    }

    try {
        let res = await fetch(`${BASE_URL}/transcribe/video_upload`, {
            method: "POST",
            body: formData,
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.detail || "فشل تفريغ الفيديو. يرجى المحاولة مرة أخرى.");
        }

        let data = await res.json();
        fullTranscript = data.full_text;
        renderTranscript(data.segments); // Pass segments for timestamp functionality

        // Update video watched percentage (placeholder, ideally tracked real-time)
        studentLessonData.video_watched_percentage = 1.0; // Assume full video watched for simplicity after transcription
        studentLessonData.time_spent_minutes = studentLessonData.total_lecture_duration_minutes; // Assume spent full time for simplicity

        // Show the other sections
        document.getElementById('transcript-section').style.display = '';
        document.getElementById('summary-section').style.display = '';
        document.getElementById('quiz-section').style.display = '';

        showOverlay('transcript-section', false);
        showGlobalMessage("تم التفريغ بنجاح! يمكنك الآن توليد الملخص والاختبار.", 'success');
        
        // After transcription, generate initial summary and quiz
        generateSummary('medium');
        generateQuiz('multiple_choice');
        evaluateUnderstanding(); // Initial evaluation

    } catch (error) {
        showOverlay('transcript-section', false); // Hide overlay even on error
        showGlobalMessage(`خطأ: ${error.message}`, 'error');
        console.error('Transcription error:', error);
    }
}

function renderTranscript(segments) {
    const transcriptDiv = document.getElementById('transcript-text');
    transcriptDiv.innerHTML = ''; // Clear previous content

    segments.forEach(segment => {
        const p = document.createElement('p');
        // Create a timestamp span that can be clicked to seek video
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'timestamp';
        timestampSpan.textContent = `[${formatTime(segment.start_time)}]`;
        timestampSpan.onclick = () => seekVideo(segment.start_time);
        p.appendChild(timestampSpan);

        const textSpan = document.createElement('span');
        textSpan.textContent = segment.text;
        p.appendChild(textSpan);
        transcriptDiv.appendChild(p);
    });
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000); // Get milliseconds
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function seekVideo(time) {
    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer) {
        videoPlayer.currentTime = time;
        videoPlayer.play();
    }
}

// ---- SUMMARY ----
async function generateSummary(detailLevel) {
    if (!fullTranscript) {
        showGlobalMessage("لا يوجد نص للتلخيص. قم بتفريغ الفيديو أولاً.", 'error');
        return;
    }
    showOverlay('summary-section', true, `جاري توليد ملخص ${detailLevel === 'short' ? 'قصير' : detailLevel === 'medium' ? 'متوسط' : 'مفصل'}...`);
    
    try {
        let res = await fetch(`${BASE_URL}/nlp/summarize`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({text_content: fullTranscript, detail_level: detailLevel})
        });
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.detail || "فشل توليد الملخص.");
        }
        let summary = await res.text();
        // Assuming the summary might come as paragraphs or bullet points
        document.getElementById('summary-list').innerHTML = summary
            .split('\n')
            .map(x=>x.trim())
            .filter(x=>x)
            .map(x => {
                // Check if it's already a list item or a paragraph
                if (x.startsWith('- ') || x.startsWith('* ')) {
                    return `<li>${x.substring(2)}</li>`;
                }
                // If it's a paragraph, wrap it in a list item
                return `<li>${x}</li>`;
            })
            .join('');
        showOverlay('summary-section', false);
        showGlobalMessage("تم توليد الملخص بنجاح!", 'success');
    } catch (error) {
        showOverlay('summary-section', false);
        showGlobalMessage(`خطأ في توليد الملخص: ${error.message}`, 'error');
        console.error('Summary generation error:', error);
    }
}

// ---- QUIZ ----
async function generateQuiz(quizType) {
    if (!fullTranscript) {
        showGlobalMessage("لا يوجد نص لتوليد الاختبار. قم بتفريغ الفيديو أولاً.", 'error');
        return;
    }
    showOverlay('quiz-section', true, 'جاري توليد الاختبار...');

    const quizBlock = document.getElementById('quiz-block');
    quizBlock.innerHTML = ''; // Clear previous content

    try {
        let res = await fetch(`${BASE_URL}/nlp/generate_quiz`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({text_content: fullTranscript, quiz_type: quizType, num_questions:1})
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.detail || "فشل توليد الاختبار.");
        }

        let data = await res.json();
        currentQuizQuestion = data.questions[0]; // Store the question for later evaluation

        let quizHtml = '';
        // Check quiz_type property from the received currentQuizQuestion object
        if (currentQuizQuestion.question && currentQuizQuestion.options) { // Multiple Choice
            quizHtml = `<p class="quiz-question">${currentQuizQuestion.question}</p><div class="quiz-options">`;
            currentQuizQuestion.options.forEach(opt => {
                // Use opt.label for data-label and check against correct_answer_label
                quizHtml += `<div class="quiz-option" data-label="${opt.label}" onclick="selectOption(this, '${opt.label}' === '${currentQuizQuestion.correct_answer_label}')">${opt.label}) ${opt.text}</div>`;
            });
            quizHtml += `</div>`;
        } else if (currentQuizQuestion.statement !== undefined) { // True/False
            quizHtml = `<p class="quiz-question">${currentQuizQuestion.statement}</p><div class="quiz-options">`;
            // Ensure correct_answer is boolean when checking
            quizHtml += `<div class="quiz-option" data-label="true" onclick="selectOption(this, ${currentQuizQuestion.correct_answer === true})">صحيح</div>`;
            quizHtml += `<div class="quiz-option" data-label="false" onclick="selectOption(this, ${currentQuizQuestion.correct_answer === false})">خطأ</div>`;
            quizHtml += `</div>`;
        } else if (currentQuizQuestion.question && currentQuizQuestion.expected_answer) { // Short Answer
            quizHtml = `<p class="quiz-question">${currentQuizQuestion.question}</p>`;
            quizHtml += `<input type="text" id="shortAnswerInput" placeholder="اكتب إجابتك هنا..." style="width:100%; padding:0.7rem; border-radius:7px; border:1.5px solid #ddd; margin-top:0.5rem; font-size:1em; box-sizing:border-box;">`;
            quizHtml += `<button class="btn" onclick="checkShortAnswer()">تحقق من الإجابة</button>`;
        } else {
             throw new Error("Failed to parse quiz question type.");
        }
        
        quizBlock.innerHTML = quizHtml;
        showOverlay('quiz-section', false);
        showGlobalMessage("تم توليد الاختبار بنجاح!", 'success');
        
        studentLessonData.quiz_attempts_count++; // Increment attempt count
        updateSidebarStats();

    } catch (error) {
        showOverlay('quiz-section', false);
        showGlobalMessage(`خطأ في توليد الاختبار: ${error.message}`, 'error');
        console.error('Quiz generation error:', error);
    }
}

function selectOption(element, isCorrect) {
    // Disable all options after selection
    document.querySelectorAll('#quiz-block .quiz-option').forEach(opt => {
        opt.style.pointerEvents = 'none'; // Disable clicking
        opt.onclick = null; // Remove click handler
    });

    if (isCorrect) {
        element.classList.add('correct');
        showGlobalMessage("إجابة صحيحة!", 'success');
        if (currentQuizQuestion) {
            studentLessonData.quiz_scores.push(100); // Add full score
        }
    } else {
        element.classList.add('wrong');
        showGlobalMessage("إجابة خاطئة. حاول مرة أخرى أو راجع الدرس.", 'error');
        if (currentQuizQuestion) {
            studentLessonData.quiz_scores.push(0); // Add zero score
            // Identify difficult concept based on quiz question type
            if (currentQuizQuestion.question) { 
                studentLessonData.difficult_concepts.push(currentQuizQuestion.question);
            } else if (currentQuizQuestion.statement) {
                studentLessonData.difficult_concepts.push(currentQuizQuestion.statement);
            }
        }
        // Highlight the correct answer if it's multiple choice/true false
        const correctLabel = currentQuizQuestion.correct_answer_label !== undefined 
                             ? currentQuizQuestion.correct_answer_label 
                             : String(currentQuizQuestion.correct_answer); // For true/false
        
        const correctOption = Array.from(document.querySelectorAll('#quiz-block .quiz-option'))
                                .find(opt => opt.dataset.label === correctLabel);
        if (correctOption) {
            correctOption.classList.add('correct');
        }
    }
    evaluateUnderstanding(); // Re-evaluate understanding after quiz attempt
}

function checkShortAnswer() {
    if (!currentQuizQuestion || !currentQuizQuestion.expected_answer) return; // Check if it's indeed a short answer question

    const inputElement = document.getElementById('shortAnswerInput');
    const userAnswer = inputElement.value.trim();
    const expectedAnswer = currentQuizQuestion.expected_answer.trim();

    // Simple string comparison for now. For robust checking,
    // you'd need fuzzy matching or an AI-based answer evaluator.
    const isCorrect = userAnswer.toLowerCase() === expectedAnswer.toLowerCase();

    if (isCorrect) {
        showGlobalMessage("إجابة صحيحة!", 'success');
        inputElement.style.borderColor = '#28a745';
        studentLessonData.quiz_scores.push(100);
    } else {
        showGlobalMessage(`إجابة خاطئة. الإجابة المتوقعة كانت: "${expectedAnswer}"`, 'error');
        inputElement.style.borderColor = '#dc3545';
        studentLessonData.quiz_scores.push(0);
        if (currentQuizQuestion.question) {
            studentLessonData.difficult_concepts.push(currentQuizQuestion.question);
        }
    }
    inputElement.disabled = true; // Disable input after submission
    document.querySelector('#quiz-block .btn').style.pointerEvents = 'none'; // Disable check button
    evaluateUnderstanding(); // Re-evaluate understanding after quiz attempt
}

// ---- TRANSCRIPT SEARCH ----
// This needs to be smarter, current implementation might be clunky with paragraph structure
function searchTranscript(query) {
    const transcriptDiv = document.getElementById('transcript-text');
    // Re-render the original transcript each time to clear previous highlights
    if (fullTranscript) {
        // This requires `data.segments` to be stored globally or re-fetched.
        // For simplicity, let's assume `fullTranscript` can be split back.
        // A better way would be to store the original `data.segments` globally.
        // For now, let's just use textContent and search that.
        // A more robust solution would re-call renderTranscript with original segments
        // then apply highlights. For quick testing, this simple text replacement will work.

        // Get the current displayed text, including timestamps but without HTML tags for searching
        const displayedText = transcriptDiv.textContent; 

        // If query is empty or too short, reset highlights
        if (!query || query.length < 2) {
            // Restore original transcript HTML if you have `data.segments` stored
            // For now, simple text replacement will keep it unhighlighted
            transcriptDiv.innerHTML = transcriptDiv.innerHTML.replace(/<mark class="highlight">(.*?)<\/mark>/g, '$1');
            return;
        }

        const re = new RegExp(query, 'gi');
        let newHtml = transcriptDiv.innerHTML.replace(/<mark class="highlight">(.*?)<\/mark>/g, '$1'); // Remove old highlights first

        // This approach is problematic as it replaces content within timestamps too.
        // A better approach is to re-render segments and then highlight.
        // For current setup, we need a way to get raw segment texts.
        // Let's make a simplified highlight for demonstration.

        // Simpler approach: find all text nodes and replace. This can break HTML.
        // A robust solution needs to parse segments and then highlight text content.
        // Given `renderTranscript` uses spans, let's try to highlight within those.

        // Get all text spans, excluding timestamps
        Array.from(transcriptDiv.querySelectorAll('p > span:last-child')).forEach(span => {
            const originalText = span.textContent;
            span.innerHTML = originalText.replace(re, match => `<mark class="highlight">${match}</mark>`);
        });
    }
}


// ---- CHAT ----
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    appendChat('user', text);
    input.value = '';
    showOverlay('chat-panel', true, 'جاري الرد...'); // Show overlay on chat panel

    // If the user asks for an explanation, increment count
    const explanationKeywords = ["ما هو", "اشرح", "عرف", "ماذا يعني", "توضيح", "explain", "what is"]; // Added English keywords
    const isExplanationQuery = explanationKeywords.some(keyword => text.toLowerCase().includes(keyword));
    if (isExplanationQuery) {
        studentLessonData.explanations_requested_count++;
        evaluateUnderstanding(); // Re-evaluate understanding
    }

    try {
        let res = await fetch(`${BASE_URL}/chatbot/ask`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                user_message: text,
                chat_history: chatHistory,
                lesson_context: fullTranscript
            })
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.detail || "عذراً، حدث خطأ أثناء معالجة طلبك.");
        }

        let aiResponse = await res.text();
        appendChat('ai', aiResponse);
        showOverlay('chat-panel', false); // Hide overlay after response
    } catch (error) {
        showOverlay('chat-panel', false); // Hide overlay even on error
        showGlobalMessage(`خطأ في المساعد الذكي: ${error.message}`, 'error');
        console.error('Chatbot error:', error);
    }
}

function appendChat(role, msg) {
    const messages = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'message ' + (role === 'user' ? 'user-message' : 'ai-message');
    div.textContent = msg;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight; // Auto-scroll to bottom
    chatHistory.push({role: role === 'user' ? 'user' : 'assistant', content: msg});
}

// ---- UNDERSTANDING EVALUATION ----
async function evaluateUnderstanding() {
    // Only evaluate if there's enough data (e.g., at least one quiz score or video watched)
    if (studentLessonData.quiz_scores.length === 0 && studentLessonData.video_watched_percentage === 0) {
        document.getElementById('sidebar-understanding').textContent = `--%`; // Reset if no data
        document.getElementById('recommendations-section').style.display = 'none';
        updateSidebarStats();
        return; 
    }

    try {
        const response = await fetch(`${BASE_URL}/analytics/evaluate_understanding`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(studentLessonData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || "فشل تقييم الفهم.");
        }

        const data = await response.json();
        const understandingScore = data.understanding_score;
        const recommendations = data.recommendations;

        document.getElementById('sidebar-understanding').textContent = `${Math.round(understandingScore)}%`;

        renderRecommendations(recommendations);
        updateSidebarStats(); // Update other stats after evaluation

    } catch (error) {
        console.error("Error evaluating understanding:", error);
        // showGlobalMessage(`خطأ في تقييم الفهم: ${error.message}`, 'error'); // Don't spam user with evaluation errors
    }
}

function renderRecommendations(recommendations) {
    const recommendationsSection = document.getElementById('recommendations-section');
    const recommendationsList = document.getElementById('recommendations-list');
    recommendationsList.innerHTML = '';

    if (recommendations && recommendations.length > 0) {
        recommendations.forEach(rec => {
            const li = document.createElement('li');
            li.textContent = rec;
            recommendationsList.appendChild(li);
        });
        recommendationsSection.style.display = 'block'; // Use 'block' to show
    } else {
        recommendationsSection.style.display = 'none';
    }
}

// Initial calls on page load
document.addEventListener('DOMContentLoaded', () => {
    updateSidebarStats(); // Set initial stats to 0
    // Hide all sections until video is uploaded
    document.getElementById('video-section').style.display = 'none';
    document.getElementById('transcript-section').style.display = 'none';
    document.getElementById('summary-section').style.display = 'none';
    document.getElementById('quiz-section').style.display = 'none';
    document.getElementById('recommendations-section').style.display = 'none'; // Hide recommendations initially
});