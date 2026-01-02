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
    // Optional: Additional consultation phases for complex flows
    productDetails?: {
        mission: string;
        steps: CharterStep[];
    };
    packageSpecs?: {
        mission: string;
        steps: CharterStep[];
    };
    fulfillmentSpecs?: {
        mission: string;
        steps: CharterStep[];
    };
    launchKit?: {
        mission: string;
        steps: CharterStep[];
    };
}

export const SALES_CHARTER: Charter = {
    meta: {
        name: "Packageha Sales Associate",
        tone: "Professional, thorough, and consultative. Always helpful, never pushy.",
        version: "3.0",
    },

    // PHASE 1: FINDING THE PACKAGE (Packageha's packages, not client's product)
    discovery: {
        mission: "Find the best match ID for the user's request from the provided inventory list.",
        rules: [
            "IGNORE prefixes like 'TEST' or 'rs-' in package titles.",
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

    // STEP 1: Product Details - Information about what goes inside the package
    productDetails: {
        mission: "Collect information about the product that will go inside the package to help recommend the right packaging solution.",
        steps: [
            {
                id: "product_description",
                question: "First, tell me about your product. What is it? What does it do?",
            },
            {
                id: "product_dimensions",
                question: "What are your product dimensions? (Length x Width x Height in cm or inches)",
                validation: (answer: string) => {
                    const hasNumbers = /\d/.test(answer);
                    if (!hasNumbers) return "Please include dimensions with numbers (e.g., 20x15x10 cm).";
                    return true;
                }
            },
            {
                id: "product_weight",
                question: "Approximately how much does your product weigh? (grams or ounces)",
            },
            {
                id: "fragility",
                question: "Is your product fragile? Does it need special protection?",
                options: ["Not fragile", "Somewhat fragile", "Very fragile", "Needs cushioning/protection"],
                multiple: false
            },
            {
                id: "budget",
                question: "What's your budget range for packaging? (per unit or total)",
                options: ["Under 1 SAR/unit", "1-5 SAR/unit", "5-10 SAR/unit", "10-20 SAR/unit", "20+ SAR/unit", "Budget flexible", "Will discuss"],
                multiple: false
            }
        ]
    },

    // STEP 2: Package Selection - Packageha package search/selection with specifications
    // This uses discovery + variant for finding the Packageha package, then collects package specs
    // Note: "package" here refers to Packageha's packages (what we sell), NOT the client's product
    packageSpecs: {
        mission: "Collect package specifications (material, print) after Packageha package is selected. Note: Dimensions are only required for Custom Packages.",
        steps: [
            { 
                id: "material", 
                question: "Do you have a preference for Material?",
                options: ["Corrugated", "Folding Carton", "Rigid Box", "Paperboard", "Kraft", "White Cardboard"],
                multiple: false // Single selection (radio buttons)
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
            }
        ]
    },

    // STEP 3: Fulfilment Specs - Order fulfillment information
    fulfillmentSpecs: {
        mission: "Collect all information needed for order fulfillment and delivery.",
        steps: [
            { 
                id: "quantity", 
                question: "What quantity would you like to order?",
                validation: (answer: string) => {
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
                id: "timeline", 
                question: "When is your deadline for delivery?",
                options: ["1-2 weeks", "2-4 weeks", "1-2 months", "2-3 months", "3+ months", "Flexible"],
                multiple: false
            },
            {
                id: "shipping_address",
                question: "Where should we deliver the order? (Please provide shipping address or city/region)",
            },
            {
                id: "special_instructions",
                question: "Any special fulfillment instructions or requirements? (optional - type 'none' to skip)",
            }
        ]
    },

    // STEP 4: Launch Kit - Brand launch services
    launchKit: {
        mission: "Offer and collect information for brand launch services.",
        steps: [
            {
                id: "service_selection",
                question: "Would you like to add any brand launch services? (Select all that apply)",
                options: [
                    "Hero shot photography - 1,200 SAR",
                    "Stop-motion unboxing video - 1,800 SAR",
                    "E-commerce product photos - 900 SAR",
                    "3D render with packaging for website - 1,500 SAR",
                    "Package design consultation - 600 SAR",
                    "Brand styling consultation - 700 SAR",
                    "None - skip launch services"
                ],
                multiple: true // Checkboxes - can select multiple
            },
            {
                id: "service_timeline",
                question: "What's your timeline for these services?",
                options: ["ASAP", "1-2 weeks", "2-4 weeks", "1-2 months", "Flexible"],
                multiple: false
            },
            {
                id: "service_notes",
                question: "Any specific requirements or details for the launch services? (optional - type 'none' to skip)",
            }
        ]
    },

    // Legacy consultation - kept for backward compatibility but not used in new flow
    consultation: {
        mission: "Legacy - not used in new flow structure",
        steps: []
    }
};

/**
 * Launch Kit Charter - Studio services ordering
 * @deprecated - Integrated into SALES_CHARTER.launchKit
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
