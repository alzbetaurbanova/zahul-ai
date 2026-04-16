#!/bin/bash

echo "Starting zahul-ai setup and launch..."
echo ""

# Check if we're in the zahul-ai directory, if not try to navigate there
if [ ! -f "main.py" ]; then
    if [ -d "zahul-ai" ]; then
        cd zahul-ai
    else
        echo "Error: zahul-ai directory not found."
        echo "Please ensure you're in the correct directory."
        read -p "Press any key to continue..." -n1 -s
        echo ""
        exit 1
    fi
fi

# Check if Python is installed
if ! command -v python &> /dev/null; then
    echo "Error: Python is not installed."
    read -p "Press any key to continue..." -n1 -s
    echo ""
    exit 1
fi

# Check if uv is installed, if not install it
if ! command -v uv &> /dev/null; then
    echo "UV package installer not found. Installing UV..."
    pip install uv
    echo "UV installed successfully."
    echo ""
else
    echo "UV is already installed."
    echo ""
fi

# Set up virtual environment
echo "Setting up Python virtual environment..."
if [ ! -d "venv" ]; then
    echo "Creating new virtual environment..."
    uv venv venv
    echo "Virtual environment created."
else
    echo "Virtual environment already exists."
fi

# Activate the virtual environment
echo "Activating virtual environment..."
source venv/bin/activate
echo "Virtual environment activated."
echo ""

# Install requirements
if [ -f "requirements.txt" ]; then
    echo "Installing project requirements using UV..."
    uv pip install -r requirements.txt
    echo "Requirements installed successfully."
    echo ""
else
    echo "Warning: requirements.txt not found."
fi

# Run the main.py file
echo "Starting zahul-ai application..."
echo ""
echo "---------------------------------------------"
echo "Running main.py"
echo "---------------------------------------------"
echo ""

python main.py

# Deactivate virtual environment when done
deactivate
echo "Virtual environment deactivated."

echo ""
echo "Application execution completed."
read -p "Press any key to continue..." -n1 -s
echo ""
