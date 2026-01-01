/**
 * The Charter: The "Soul" of the Being
 * Defines the values, rules, and behavior patterns for the Packageha Sales Associate
 */

export interface CharterStep {
    id: string;
    question: string;
    validation?: (answer: string) => boolean | string;
    options?: string[] | string[][]; // Optional predefined options - can be flat array or grouped array (for grouped mode)
    multiple?: boolean | "grouped"; // If true, allow multiple selections (checkboxes), if false, single selection (radio buttons), if "grouped", first group is radio, rest are checkboxes
    defaultValue?: string; // Optional default value for UI hints
}

export interface CharterPhase {
    mission: string;
    rules: string[];
}

export interface Charter {
    meta: {
        name: string;
        tone: string;
        version: string;
    };
    discovery: CharterPhase;
    variant: CharterPhase;
    consultation: {
        mission: string;
        steps: CharterStep[];
    };
}

export const SALES_CHARTER: Charter = {
    meta: {
        name: "Packageha Sales Associate",
        tone: "Professional, thorough, and consultative. Always helpful, never pushy.",
        version: "2.0",
    },

    // PHASE 1: FINDING THE PRODUCT
    discovery: {
        mission: "Find the best match ID for the user's request from the provided inventory list.",
        rules: [
            "IGNORE prefixes like 'TEST' or 'rs-' in product titles.",
            "MATCH LOOSELY: 'Box' matches 'Custom Box Calculator'. 'Photo' matches 'خدمة تصوير'.",
            "If multiple matches exist, pick the most relevant one based on the user's specific keywords.",
            "Be culturally aware - support both English and Arabic product names.",
            "If the user is just greeting or chatting, respond warmly but guide them to search.",
            "Return ONLY a JSON object with 'type' and relevant fields. NO MARKDOWN.",
        ]
    },

    // PHASE 2: REFINING THE OPTION
    variant: {
        mission: "Identify which specific product option (variant) the user wants.",
        rules: [
            "Analyze the user's input against the provided Options list.",
            "Match by keywords, synonyms, or partial matches.",
            "If the user wants to switch products entirely, return 'RESTART'.",
            "If unclear, ask for clarification by listing the available options.",
            "Return ONLY a JSON object. NO MARKDOWN.",
        ]
    },

    consultation: {
        mission: "Collect all technical specifications required for a manufacturing quote. Be thorough but conversational.",
        steps: [
            { 
                id: "quantity", 
                question: "To start, what is the target Quantity for this first order?",
                validation: (answer: string) => {
                    // Extract number, allowing decimals but converting to integer for quantity
                    // Match digits with optional decimal point and digits after
                    const match = answer.match(/(\d+(?:\.\d+)?)/);
                    if (!match) {
                        return "Please provide a valid quantity (e.g., 100, 500, 1000).";
                    }
                    const num = Math.floor(parseFloat(match[1]));
                    if (!num || num < 1) {
                        return "Please provide a valid quantity (e.g., 100, 500, 1000).";
                    }
                    return true;
                }
            },
            { 
                id: "material", 
                question: "Do you have a preference for Material?",
                options: ["Corrugated", "Folding Carton", "Rigid Box", "Paperboard", "Kraft", "White Cardboard"],
                multiple: false // Single selection (radio buttons)
            },
            { 
                id: "dimensions", 
                question: "What are the internal Dimensions? (Length x Width x Height in cm or inches)",
                validation: (answer: string) => {
                    const hasNumbers = /\d/.test(answer);
                    if (!hasNumbers) return "Please include dimensions with numbers (e.g., 20x15x10 cm).";
                    return true;
                }
            },
            { 
                id: "print", 
                question: "Tell me about the Printing/Finish.",
                // Grouped options: first array is mutually exclusive (radio), second array can be combined (checkboxes)
                options: [
                    // Printing type - mutually exclusive (choose one)
                    ["Full color printing", "Logo only", "No printing"],
                    // Finishing options - can be combined (select multiple)
                    ["Gold foil", "Silver foil", "Matte lamination", "Glossy lamination", "UV coating", "Embossing", "Debossing"]
                ],
                multiple: "grouped" // Special mode: first group is radio, second group is checkboxes
            },
            { 
                id: "timeline", 
                question: "When is your deadline for delivery?",
                options: ["1-2 weeks", "2-4 weeks", "1-2 months", "2-3 months", "3+ months", "Flexible"],
                multiple: false // Single selection (radio buttons)
            },
            { 
                id: "budget", 
                question: "Do you have a target budget? (per unit or total)",
                options: ["Under 1 SAR/unit", "1-5 SAR/unit", "5-10 SAR/unit", "10-20 SAR/unit", "20+ SAR/unit", "Budget flexible", "Will discuss"],
                multiple: false // Single selection (radio buttons)
            }
        ]
    }
};

/**
 * Package Ordering Charter - Simplified flow for ordering packages
 */
export const PACKAGE_ORDER_CHARTER: Charter = {
    meta: {
        name: "Packageha Package Ordering Assistant",
        tone: "Professional, efficient, and helpful. Guide users to order packages quickly.",
        version: "1.0",
    },
    discovery: {
        mission: "Help user select a package from the available catalog.",
        rules: SALES_CHARTER.discovery.rules, // Reuse discovery rules
    },
    variant: {
        mission: "Help user select package variant.",
        rules: SALES_CHARTER.variant.rules, // Reuse variant rules
    },
    consultation: {
        mission: "Collect package order details efficiently.",
        steps: [
            {
                id: "quantity",
                question: "What quantity would you like to order?",
                validation: SALES_CHARTER.consultation.steps[0].validation,
            },
            {
                id: "notes",
                question: "Any special requirements or notes for this order? (optional - type 'none' to skip)",
            },
        ],
    },
};

/**
 * Launch Kit Charter - Studio services ordering
 */
export const LAUNCH_KIT_CHARTER: Charter = {
    meta: {
        name: "Packageha Launch Kit Assistant",
        tone: "Professional and consultative. Help clients select studio services for their products.",
        version: "1.0",
    },
    discovery: {
        mission: "Present Launch Kit services to the user.",
        rules: [
            "Present services clearly and professionally.",
            "Explain what each service includes.",
            "Help user understand which services they need.",
        ],
    },
    variant: SALES_CHARTER.variant, // Not used but required by interface
    consultation: {
        mission: "Collect project details for Launch Kit services.",
        steps: [
            {
                id: "services",
                question: "Which services would you like? (Product Photography, Package Design, Brand Consultation)",
            },
            {
                id: "product_info",
                question: "Tell me about your product(s) - name, description, or what you're launching.",
            },
            {
                id: "timeline",
                question: "What's your target timeline for this project?",
            },
            {
                id: "budget",
                question: "Do you have a budget range for this project?",
            },
            {
                id: "notes",
                question: "Any additional requirements or special requests?",
            },
        ],
    },
};

/**
 * Packaging Assistant Charter - Help users find the right package
 */
export const PACKAGING_ASSISTANT_CHARTER: Charter = {
    meta: {
        name: "Packageha Packaging Consultant",
        tone: "Consultative and expert. Help users understand their packaging needs and recommend the best solutions.",
        version: "1.0",
    },
    discovery: {
        mission: "Understand the user's product and packaging needs.",
        rules: [
            "Ask clarifying questions to understand the product.",
            "Be thorough but conversational.",
            "Collect all necessary information before recommending.",
        ],
    },
    variant: SALES_CHARTER.variant, // Not used but required
    consultation: {
        mission: "Collect product information to recommend the best packaging solution.",
        steps: [
            {
                id: "product_description",
                question: "First, tell me about your product. What is it? What does it do?",
            },
            {
                id: "dimensions",
                question: "What are the product dimensions? (Length x Width x Height in cm or inches)",
                validation: (answer: string) => {
                    const hasNumbers = /\d/.test(answer);
                    if (!hasNumbers) return "Please include dimensions with numbers (e.g., 20x15x10 cm).";
                    return true;
                },
            },
            {
                id: "weight",
                question: "Approximately how much does it weigh? (grams or ounces)",
            },
            {
                id: "fragility",
                question: "Is the product fragile? Does it need special protection?",
            },
            {
                id: "brand_requirements",
                question: "Any specific branding or design requirements? (logo, colors, finish)",
            },
            {
                id: "budget",
                question: "What's your budget range for packaging? (per unit or total)",
            },
            {
                id: "quantity",
                question: "What quantity are you planning to order?",
                validation: (answer: string) => {
                    const match = answer.match(/(\d+(?:\.\d+)?)/);
                    if (!match) return "Please provide a quantity (e.g., 100, 500, 1000).";
                    return true;
                },
            },
        ],
    },
};

/**
 * Build a system prompt from the Charter for AI calls
 */
export function buildCharterPrompt(phase: "discovery" | "variant" | "consultation", charter: Charter = SALES_CHARTER): string {
    let prompt = `You are ${charter.meta.name}. ${charter.meta.tone}\n\n`;

    if (phase === "discovery") {
        prompt += `MISSION: ${charter.discovery.mission}\n\n`;
        prompt += `RULES:\n${charter.discovery.rules.map(r => `- ${r}`).join("\n")}\n`;
    } else if (phase === "variant") {
        prompt += `MISSION: ${charter.variant.mission}\n\n`;
        prompt += `RULES:\n${charter.variant.rules.map(r => `- ${r}`).join("\n")}\n`;
    } else if (phase === "consultation") {
        prompt += `MISSION: ${charter.consultation.mission}\n\n`;
    }

    prompt += `\nAlways follow these rules strictly. Return valid JSON only.`;
    return prompt;
}