import jsPDF from 'jspdf';

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    detailedSummary?: {
        actionItems: string[];
        keyPoints: string[];
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
}

export const generateMeetingPDF = (meeting: Meeting) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let y = 20;

    // Helper for adding text with auto-page break
    const addText = (text: string, fontSize: number = 10, isBold: boolean = false, color: string = '#000000') => {
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', isBold ? 'bold' : 'normal');
        doc.setTextColor(color);

        const lines = doc.splitTextToSize(text, contentWidth);

        // Check if we need a new page
        if (y + (lines.length * fontSize * 0.5) > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage();
            y = 20;
        }

        doc.text(lines, margin, y);
        y += (lines.length * fontSize * 0.5) + 2; // Add some spacing
    };

    const addVerticalSpace = (amount: number) => {
        y += amount;
    };

    // --- Header ---
    addText(meeting.title, 18, true, '#000000');
    addVerticalSpace(2);
    addText(`${meeting.date} • ${meeting.duration}`, 10, false, '#666666');
    addVerticalSpace(10);

    // --- Summary ---
    if (meeting.summary) {
        addText('Summary', 14, true, '#000000');
        addVerticalSpace(2);
        addText(meeting.summary, 10, false, '#333333');
        addVerticalSpace(8);
    }

    if (meeting.detailedSummary) {
        if (meeting.detailedSummary.actionItems && meeting.detailedSummary.actionItems.length > 0) {
            addText('Action Items', 12, true, '#000000');
            meeting.detailedSummary.actionItems.forEach(item => {
                addText(`• ${item}`, 10, false, '#333333');
            });
            addVerticalSpace(5);
        }

        if (meeting.detailedSummary.keyPoints && meeting.detailedSummary.keyPoints.length > 0) {
            addText('Key Points', 12, true, '#000000');
            meeting.detailedSummary.keyPoints.forEach(point => {
                addText(`• ${point}`, 10, false, '#333333');
            });
            addVerticalSpace(8);
        }
    }

    // --- Transcript ---
    if (meeting.transcript && meeting.transcript.length > 0) {
        addText('Transcript', 14, true, '#000000');
        addVerticalSpace(2);

        meeting.transcript.forEach(entry => {
            const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            // Speaker line
            addText(`${entry.speaker} [${timeStr}]`, 10, true, '#444444');
            // Text line
            addText(entry.text, 10, false, '#333333');
            addVerticalSpace(2);
        });
        addVerticalSpace(8);
    }

    // --- Usage (Q&A / AI Interactions) ---
    if (meeting.usage && meeting.usage.length > 0) {
        addText('AI Usage & Interactions', 14, true, '#000000');
        addVerticalSpace(2);

        meeting.usage.forEach(item => {
            if (item.type === 'chat' && item.question && item.answer) {
                addText(`Q: ${item.question}`, 10, true, '#222222');
                addText(`A: ${item.answer}`, 10, false, '#444444');
                addVerticalSpace(3);
            }
            else if (item.type === 'assist' && item.answer) {
                addText('Assist:', 10, true, '#222222');
                addText(item.answer, 10, false, '#444444');
                addVerticalSpace(3);
            }
        });
    }

    // Save
    const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    doc.save(`${safeTitle}.pdf`);
};
